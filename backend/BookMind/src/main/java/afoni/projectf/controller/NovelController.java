package afoni.projectf.controller;

import afoni.projectf.service.BookTextExtractor;
import tools.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/novels")
public class NovelController {
    private static final int MAX_FILES=100, MAX_CHAPTERS=500, MAX_TEXT=12_000_000;
    private static final long MAX_UPLOAD=30L*1024*1024;
    private final JdbcTemplate jdbc;
    private final BookTextExtractor extractor;
    private final ObjectMapper mapper=new ObjectMapper();

    public NovelController(JdbcTemplate jdbc,BookTextExtractor extractor) {
        this.jdbc=jdbc;this.extractor=extractor;
    }

    record PreviewChapter(String key,String title,String filename,String format,int characters) {}
    record Preview(List<PreviewChapter> chapters) {}
    record ChapterInput(@NotBlank String key,@NotBlank @Size(max=500) String title) {}
    record Layout(@NotEmpty List<@Valid ChapterInput> chapters) {}
    record Chapter(UUID id,int number,String title,String filename,String format,int characters,Instant createdAt,boolean read) {}
    record ChapterReadInput(boolean read) {}
    record ChapterOrderInput(@NotEmpty List<@Valid OrderedChapter> chapters) {}
    record OrderedChapter(UUID id,@NotBlank @Size(max=500) String title) {}
    record NovelResult(UUID id,List<Chapter> chapters) {}
    private record Candidate(String key,String title,String filename,String format,String hash,int sourceNumber,String content,
                             List<BookTextExtractor.AssetData> assets) {}
    private record Position(UUID chapterId,int number,int start,int end) {}
    private record StoredChapter(UUID id,String title,String content) {}
    private record ProgressRow(int position,int confirmed) {}
    private record HighlightRow(UUID id,int start,int end,String exactText) {}

    @PostMapping(value="/preview",consumes="multipart/form-data")
    Preview preview(Authentication auth,@RequestPart("files") List<MultipartFile> files) {
        owner(auth);
        var candidates=parse(files);
        return new Preview(candidates.stream().map(value->new PreviewChapter(value.key(),value.title(),value.filename(),value.format(),value.content().length())).toList());
    }

    @PostMapping(value="",consumes="multipart/form-data")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    NovelResult create(Authentication auth,@RequestPart("files") List<MultipartFile> files,
                       @RequestPart("layout") String rawLayout,@RequestPart("title") String rawTitle,
                       @RequestPart(value="author",required=false) String rawAuthor) {
        String title=title(rawTitle,200),author=optional(rawAuthor,500);
        var chosen=ordered(parse(files),layout(rawLayout));
        UUID id=UUID.randomUUID();
        checkDuplicates(id,chosen);
        String text=join(chosen);
        jdbc.update("INSERT INTO documents(id,user_id,title,original_text,source_type,material_type,author,original_size,reader_structure_version) VALUES (?,?,?,?, 'novel','BOOK',?,?,4)",
                id,owner(auth),title,text,author,totalSize(files));
        insert(id,chosen,0);
        rebuild(id,List.of());
        return new NovelResult(id,chapters(id));
    }

    @GetMapping("/{id}/chapters")
    List<Chapter> chapters(Authentication auth,@PathVariable UUID id) {
        owned(id,auth,false);
        return chapters(id);
    }

    @PostMapping(value="/{id}/chapters",consumes="multipart/form-data")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    NovelResult add(Authentication auth,@PathVariable UUID id,@RequestPart("files") List<MultipartFile> files,
                    @RequestPart("layout") String rawLayout,@RequestParam(value="insertAt",required=false) Integer insertAt) {
        owned(id,auth,true);
        var chosen=ordered(parse(files),layout(rawLayout));
        var before=positions(id);
        ensureNoActiveSummary(id);
        var existing=jdbc.query("SELECT id FROM novel_chapters WHERE document_id=? ORDER BY chapter_number",
                (rs,n)->rs.getObject(1,UUID.class),id);
        if(existing.size()+chosen.size()>MAX_CHAPTERS) throw bad("В новелле может быть не больше 500 глав");
        int at=insertAt==null?existing.size():insertAt;
        if(at<0 || at>existing.size()) throw bad("Некорректное место вставки глав");
        checkDuplicates(id,chosen);
        jdbc.update("UPDATE novel_chapters SET chapter_number=chapter_number+100000 WHERE document_id=?",id);
        var added=insert(id,chosen,200000);
        var order=new ArrayList<UUID>(existing);
        order.addAll(at,added);
        setOrder(id,order);
        rebuild(id,before);
        jdbc.update("UPDATE documents SET original_size=COALESCE(original_size,0)+? WHERE id=?",totalSize(files),id);
        return new NovelResult(id,chapters(id));
    }

    @PutMapping("/{id}/chapters/order")
    @Transactional
    NovelResult reorder(Authentication auth,@PathVariable UUID id,@Valid @RequestBody ChapterOrderInput input) {
        owned(id,auth,true);
        var before=positions(id);
        ensureNoActiveSummary(id);
        var existing=jdbc.query("SELECT id FROM novel_chapters WHERE document_id=? ORDER BY chapter_number",
                (rs,n)->rs.getObject(1,UUID.class),id);
        if(input.chapters().size()!=existing.size() || !new HashSet<>(existing).equals(input.chapters().stream().map(OrderedChapter::id).collect(java.util.stream.Collectors.toSet())))
            throw bad("Список глав изменился. Обновите страницу и повторите попытку");
        jdbc.update("UPDATE novel_chapters SET chapter_number=chapter_number+100000 WHERE document_id=?",id);
        int number=0;
        for(var chapter:input.chapters()) jdbc.update("UPDATE novel_chapters SET chapter_number=?,title=? WHERE document_id=? AND id=?",
                number++,title(chapter.title(),500),id,chapter.id());
        rebuild(id,before);
        return new NovelResult(id,chapters(id));
    }

    @PutMapping("/{id}/chapters/{chapterId}/read")
    @Transactional
    Chapter markRead(Authentication auth,@PathVariable UUID id,@PathVariable UUID chapterId,@RequestBody ChapterReadInput input) {
        owned(id,auth,false);
        if(jdbc.update("UPDATE novel_chapters SET read_override=? WHERE id=? AND document_id=?",input.read(),chapterId,id)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Глава не найдена");
        return chapters(id).stream().filter(chapter->chapter.id().equals(chapterId)).findFirst().orElseThrow();
    }

    @PostMapping("/{id}/chapters/number/{number}/complete")
    @Transactional
    Chapter completeChapter(Authentication auth,@PathVariable UUID id,@PathVariable int number) {
        owned(id,auth,false);
        // Section bounds are Java string offsets; PostgreSQL length() counts code points and is shorter for emoji.
        if(jdbc.update("UPDATE novel_chapters n SET confirmed_offset=s.end_offset-s.start_offset,read_override=NULL FROM reader_sections s "+
                "WHERE s.novel_chapter_id=n.id AND n.document_id=? AND n.chapter_number=?",id,number)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Глава не найдена");
        return chapters(id).stream().filter(chapter->chapter.number()==number).findFirst().orElseThrow();
    }

    @DeleteMapping("/{id}/chapters/{chapterId}")
    @Transactional
    NovelResult deleteChapter(Authentication auth,@PathVariable UUID id,@PathVariable UUID chapterId) {
        owned(id,auth,true);
        var before=positions(id);
        if(before.size()<=1) throw bad("В новелле должна остаться хотя бы одна глава");
        var removed=before.stream().filter(position->position.chapterId().equals(chapterId)).findFirst()
                .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Глава не найдена"));
        ensureNoActiveSummary(id);
        jdbc.update("DELETE FROM reader_highlights WHERE document_id=? AND start_offset<? AND end_offset>?",id,removed.end(),removed.start());
        jdbc.update("DELETE FROM reader_bookmarks WHERE document_id=? AND position_offset>=? AND position_offset<?",id,removed.start(),removed.end());
        jdbc.update("DELETE FROM novel_chapters WHERE document_id=? AND id=?",id,chapterId);
        var remaining=jdbc.query("SELECT id FROM novel_chapters WHERE document_id=? ORDER BY chapter_number",
                (rs,n)->rs.getObject(1,UUID.class),id);
        jdbc.update("UPDATE novel_chapters SET chapter_number=chapter_number+100000 WHERE document_id=?",id);
        setOrder(id,remaining);
        rebuild(id,before);
        return new NovelResult(id,chapters(id));
    }

    private List<Chapter> chapters(UUID id) {
        return jdbc.query("SELECT id,chapter_number,title,source_filename,source_format,length(content),created_at,"+
                        "COALESCE(read_override,confirmed_offset>=GREATEST(1,(length(content)*9)/10)) FROM novel_chapters WHERE document_id=? ORDER BY chapter_number",
                (rs,n)->new Chapter(rs.getObject(1,UUID.class),rs.getInt(2),rs.getString(3),rs.getString(4),rs.getString(5),rs.getInt(6),rs.getTimestamp(7).toInstant(),rs.getBoolean(8)),id);
    }

    private List<Candidate> parse(List<MultipartFile> files) {
        if(files==null || files.isEmpty() || files.size()>MAX_FILES) throw bad("Выберите от 1 до 100 файлов");
        if(totalSize(files)>MAX_UPLOAD) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Общий размер файлов не должен превышать 30 МБ");
        var result=new ArrayList<Candidate>();
        for(int fileIndex=0;fileIndex<files.size();fileIndex++) {
            MultipartFile file=files.get(fileIndex);
            String filename=Optional.ofNullable(file.getOriginalFilename()).orElse("").replace('\\','/');
            filename=filename.substring(filename.lastIndexOf('/')+1).strip();
            if(filename.isBlank() || filename.length()>255 || file.isEmpty()) throw bad("У каждого файла должно быть имя и содержимое");
            int dot=filename.lastIndexOf('.');
            String format=dot<0?"":filename.substring(dot+1).toLowerCase(Locale.ROOT);
            if(!Set.of("txt","md","docx","html","xhtml","epub","fb2").contains(format))
                throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"Для глав поддерживаются TXT, MD, DOCX, HTML, XHTML, EPUB и FB2");
            try {
                byte[] bytes=file.getBytes();
                String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                var extracted=extractor.extractBook(bytes,format);
                var assetsByPath=new HashMap<String,BookTextExtractor.AssetData>();
                for(var asset:extracted.assets()) assetsByPath.put(asset.sourcePath(),asset);
                var sections=Set.of("epub","fb2").contains(format)?extracted.sections():List.of(new BookTextExtractor.SectionData(
                        extracted.suggestedTitle()==null?filename.substring(0,dot):extracted.suggestedTitle(),extracted.text(),"main",null,
                        extracted.assets().stream().map(BookTextExtractor.AssetData::sourcePath).toList()));
                for(int sectionIndex=0;sectionIndex<sections.size();sectionIndex++) {
                    var section=sections.get(sectionIndex);
                    String content=section.text().strip();
                    if(content.isBlank()) continue;
                    String chapterTitle=Set.of("epub","fb2").contains(format)?section.title():filename.substring(0,dot);
                    var chapterAssets=new ArrayList<BookTextExtractor.AssetData>();
                    for(String path:section.assetPaths()) {var asset=assetsByPath.get(path);if(asset!=null) chapterAssets.add(asset);}
                    result.add(new Candidate(fileIndex+":"+sectionIndex,title(chapterTitle,500),filename,format,hash,sectionIndex,content,chapterAssets));
                    if(result.size()>MAX_CHAPTERS) throw bad("За один раз можно добавить не больше 500 глав");
                }
            } catch(ResponseStatusException error) { throw error; }
            catch(Exception error) { throw bad("Не удалось прочитать файл «"+filename+"»"); }
        }
        if(result.isEmpty()) throw bad("В файлах не найден текст глав");
        long assetBytes=0;int assetCount=0;
        for(var chapter:result) for(var asset:chapter.assets()) {
            assetBytes+=asset.content().length;
            if(++assetCount>500 || assetBytes>60L*1024*1024) throw bad("Слишком много изображений в выбранных файлах");
        }
        return result;
    }

    private Layout layout(String raw) {
        try { return mapper.readValue(raw,Layout.class); }
        catch(Exception error) { throw bad("Некорректный порядок глав"); }
    }
    private List<Candidate> ordered(List<Candidate> parsed,Layout layout) {
        if(layout==null || layout.chapters()==null || layout.chapters().isEmpty() || layout.chapters().size()>parsed.size()) throw bad("Выберите хотя бы одну главу из загруженных файлов");
        var byKey=new HashMap<String,Candidate>();
        for(var item:parsed) byKey.put(item.key(),item);
        var seen=new HashSet<String>();var chosen=new ArrayList<Candidate>();
        for(var item:layout.chapters()) {
            if(item==null || item.key()==null || !seen.add(item.key()) || !byKey.containsKey(item.key())) throw bad("Список глав содержит пропуск или дубликат");
            var source=byKey.get(item.key());
            chosen.add(new Candidate(source.key(),title(item.title(),500),source.filename(),source.format(),source.hash(),source.sourceNumber(),source.content(),source.assets()));
        }
        return chosen;
    }
    private List<UUID> insert(UUID documentId,List<Candidate> chapters,int startNumber) {
        var ids=new ArrayList<UUID>();int number=startNumber;
        for(var chapter:chapters) {
            UUID id=UUID.randomUUID();ids.add(id);
            jdbc.update("INSERT INTO novel_chapters(id,document_id,chapter_number,title,content,source_filename,source_format,source_sha256,source_section_number) VALUES (?,?,?,?,?,?,?,?,?)",
                    id,documentId,number++,chapter.title(),chapter.content(),chapter.filename(),chapter.format(),chapter.hash(),chapter.sourceNumber());
            int assetOrder=0;
            for(var asset:chapter.assets()) {
                jdbc.update("INSERT INTO book_assets(id,document_id,source_path,media_type,content,is_cover,novel_chapter_id,novel_order_index) VALUES (?,?,?,?,?,?,?,?)",
                        UUID.randomUUID(),documentId,"novel/"+id+"/"+assetOrder,asset.mediaType(),asset.content(),asset.cover(),id,assetOrder++);
            }
        }
        return ids;
    }
    private void checkDuplicates(UUID documentId,List<Candidate> chosen) {
        var seen=new HashSet<>(jdbc.query("SELECT source_sha256,source_section_number FROM novel_chapters WHERE document_id=?",
                (rs,n)->rs.getString(1).strip()+":"+rs.getInt(2),documentId));
        for(var chapter:chosen) {
            String key=chapter.hash()+":"+chapter.sourceNumber();
            if(!seen.add(key))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Эта глава уже добавлена в новеллу");
        }
    }
    private void setOrder(UUID documentId,List<UUID> ids) {
        for(int number=0;number<ids.size();number++) jdbc.update("UPDATE novel_chapters SET chapter_number=? WHERE document_id=? AND id=?",number,documentId,ids.get(number));
    }
    private List<Position> positions(UUID id) {
        return jdbc.query("SELECT novel_chapter_id,section_number,start_offset,end_offset FROM reader_sections WHERE document_id=? AND novel_chapter_id IS NOT NULL ORDER BY section_number",
                (rs,n)->new Position(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getInt(4)),id);
    }
    private void rebuild(UUID id,List<Position> before) {
        var chapters=jdbc.query("SELECT id,title,content FROM novel_chapters WHERE document_id=? ORDER BY chapter_number",
                (rs,n)->new StoredChapter(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3)),id);
        var text=new StringBuilder();var after=new ArrayList<Position>();
        for(int number=0;number<chapters.size();number++) {
            var chapter=chapters.get(number);
            if(number>0) text.append("\n\n");
            int start=text.length();text.append(chapter.content());
            after.add(new Position(chapter.id(),number,start,text.length()));
        }
        if(text.length()>MAX_TEXT) throw bad("Новелла не может содержать больше 12 000 000 символов");
        // Reader links and section assets refer to section numbers, so rebuild them with the sections.
        jdbc.update("DELETE FROM reader_toc_entries WHERE document_id=?",id);
        jdbc.update("DELETE FROM reader_sections WHERE document_id=?",id);
        for(int number=0;number<chapters.size();number++) {
            var chapter=chapters.get(number);var position=after.get(number);
            jdbc.update("INSERT INTO reader_sections(document_id,section_number,title,role,start_offset,end_offset,content,toc_level,novel_chapter_id) VALUES (?,?,?,'main',?,?,?,0,?)",
                    id,number,chapter.title(),position.start(),position.end(),chapter.content(),chapter.id());
            jdbc.update("INSERT INTO reader_toc_entries(document_id,entry_number,title,role,toc_level,position_offset) VALUES (?,?,?,'main',0,?)",
                    id,number,chapter.title(),position.start());
            var assetIds=jdbc.query("SELECT id FROM book_assets WHERE novel_chapter_id=? ORDER BY novel_order_index",
                    (rs,n)->rs.getObject(1,UUID.class),chapter.id());
            for(int index=0;index<assetIds.size();index++) jdbc.update("INSERT INTO reader_section_assets(document_id,section_number,asset_id,order_index) VALUES (?,?,?,?)",
                    id,number,assetIds.get(index),index);
        }
        jdbc.update("UPDATE documents SET original_text=?,updated_at=CURRENT_TIMESTAMP,reader_structure_version=4,novel_revision=novel_revision+1 WHERE id=?",text.toString(),id);
        if(!before.isEmpty()) remap(id,before,after,text.toString());
    }
    private void remap(UUID id,List<Position> before,List<Position> after,String text) {
        var next=new HashMap<UUID,Position>();for(var p:after) next.put(p.chapterId(),p);
        var progress=jdbc.query("SELECT position_offset,confirmed_offset FROM reading_progress WHERE document_id=?",
                (rs,n)->new ProgressRow(rs.getInt(1),rs.getInt(2)),id);
        if(!progress.isEmpty()) {
            int position=remapOffset(progress.getFirst().position(),before,next);
            int confirmed=remapOffset(progress.getFirst().confirmed(),before,next);
            Position anchor=at(after,position);
            jdbc.update("UPDATE reading_progress SET position_offset=?,confirmed_offset=?,section_number=?,section_offset=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE document_id=?",
                    position,confirmed,anchor.number(),Math.max(0,position-anchor.start()),id);
        }
        var bookmarks=jdbc.query("SELECT id,position_offset FROM reader_bookmarks WHERE document_id=?",
                (rs,n)->new AbstractMap.SimpleEntry<>(rs.getObject(1,UUID.class),rs.getInt(2)),id);
        for(var mark:bookmarks) jdbc.update("UPDATE reader_bookmarks SET position_offset=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                remapOffset(mark.getValue(),before,next),mark.getKey());
        var highlights=jdbc.query("SELECT id,start_offset,end_offset,exact_text FROM reader_highlights WHERE document_id=?",
                (rs,n)->new HighlightRow(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4)),id);
        for(var mark:highlights) {
            int start=remapOffset(mark.start(),before,next);
            String exact=mark.exactText();
            if(exact!=null && !exact.isEmpty() && !text.startsWith(exact,start)) {
                int found=text.indexOf(exact);
                if(found>=0) start=found;
            }
            int end=exact!=null && !exact.isEmpty() && text.startsWith(exact,start)?start+exact.length():remapOffset(mark.end(),before,next);
            end=Math.min(text.length(),Math.max(start+1,end));
            jdbc.update("UPDATE reader_highlights SET start_offset=?,end_offset=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",start,end,mark.id());
        }
    }
    private int remapOffset(int offset,List<Position> before,Map<UUID,Position> next) {
        Position old=at(before,offset),now=next.get(old.chapterId());
        if(now==null) {
            for(var previous:before) if(previous.number()>old.number() && next.containsKey(previous.chapterId()))
                return next.get(previous.chapterId()).start();
            for(int index=before.size()-1;index>=0;index--) {
                var previous=before.get(index);
                if(previous.number()<old.number() && next.containsKey(previous.chapterId()))
                    return next.get(previous.chapterId()).end();
            }
            return 0;
        }
        return now.start()+Math.min(Math.max(0,offset-old.start()),now.end()-now.start());
    }
    private Position at(List<Position> sections,int offset) {
        Position result=sections.getFirst();
        for(var section:sections) {if(section.start()>offset) break;result=section;}
        return result;
    }
    private String join(List<Candidate> chapters) {
        var text=new StringBuilder();
        for(var chapter:chapters) {if(!text.isEmpty()) text.append("\n\n");text.append(chapter.content());if(text.length()>MAX_TEXT) throw bad("Новелла не может содержать больше 12 000 000 символов");}
        return text.toString();
    }
    private long totalSize(List<MultipartFile> files) {return files.stream().mapToLong(MultipartFile::getSize).sum();}
    private void ensureNoActiveSummary(UUID id) {
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM summary_jobs WHERE document_id=? AND status IN ('queued','running','waiting'))",Boolean.class,id)))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Дождитесь окончания изложения перед изменением глав");
    }
    private String title(String value,int max) {
        if(value==null || value.isBlank() || value.strip().length()>max) throw bad("Укажите название длиной до "+max+" символов");
        return value.strip();
    }
    private String optional(String value,int max) {if(value==null || value.isBlank()) return null;return title(value,max);}
    private UUID owner(Authentication auth) {return UUID.fromString(auth.getName());}
    private void owned(UUID id,Authentication auth,boolean lock) {
        String sql="SELECT id FROM documents WHERE id=? AND user_id=? AND source_type='novel' AND material_type='BOOK'"+(lock?" FOR UPDATE":"");
        if(jdbc.query(sql,(rs,n)->rs.getObject(1,UUID.class),id,owner(auth)).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Новелла не найдена");
    }
    private ResponseStatusException bad(String message) {return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}

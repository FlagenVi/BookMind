package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.service.ReaderStructureService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/books")
public class BookController {
    private final DocumentRepository documents;
    private final JdbcTemplate jdbc;
    private final ReaderStructureService structures;

    public BookController(DocumentRepository documents, JdbcTemplate jdbc,ReaderStructureService structures) {
        this.documents=documents; this.jdbc=jdbc;this.structures=structures;
    }

    record BookItem(UUID id,String title,String author,List<String> genres,String format,String filename,Instant createdAt,
                    int textLength,int positionOffset,String preparation,boolean hasCover,String libraryStatus,
                    Instant lastReadAt,long readingSeconds) {}
    record BookPage(List<BookItem> items,int page,int totalPages,long totalElements) {}
    record Section(int number,String title,String role,int startOffset,int endOffset,int tocLevel) {}
    record TocEntry(int number,String title,String role,int level,int positionOffset) {}
    record Manifest(UUID id,String title,String format,int textLength,int positionOffset,List<Section> sections,List<TocEntry> toc) {}
    record Asset(UUID id,String mediaType) {}
    record SectionContent(int number,String title,String role,int startOffset,int endOffset,String content,List<Asset> assets) {}
    record ProgressInput(@Min(0) int positionOffset,@Min(0) Integer confirmedOffset,@Min(0) Integer version,
                         @Min(0) @Max(300) Integer elapsedSeconds) {}
    record Progress(int positionOffset,int confirmedOffset,int version,long readingSeconds,Instant lastReadAt,Instant updatedAt) {}
    record LibraryInput(@NotBlank @Pattern(regexp="want_to_read|reading|finished") String status,
                        @Size(max=500) String author,@NotNull @Size(max=12) List<@NotBlank @Size(max=60) String> genres) {}
    record LibraryMetadata(String status,String author,List<String> genres) {}
    record BookmarkInput(@Min(0) int positionOffset,@Size(max=160) String label,@NotBlank @Size(max=300) String excerpt) {}
    record Bookmark(UUID id,int positionOffset,String label,String excerpt,Instant createdAt) {}
    record HighlightInput(@Min(0) int startOffset,@Min(1) int endOffset,@Pattern(regexp="yellow|green|blue|pink") String color,
                          @NotBlank @Size(max=10000) String exactText,@Size(max=2000) String note) {}
    record Highlight(UUID id,int startOffset,int endOffset,String color,String exactText,String note,Instant createdAt) {}

    @GetMapping BookPage list(Authentication auth,@RequestParam(defaultValue="0") int page,
                              @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="all") String status,
                              @RequestParam(defaultValue="recent") String sort) {
        if(page<0 || page>100000 || q.length()>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if(!Set.of("all","want_to_read","reading","finished").contains(status)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестный статус книги");
        String order=switch(sort) {
            case "recent" -> "COALESCE(r.last_read_at,d.created_at) DESC,d.id";
            case "added" -> "d.created_at DESC,d.id";
            case "title" -> "lower(d.title),d.id";
            case "author" -> "lower(COALESCE(d.author,'')),lower(d.title),d.id";
            case "progress" -> "COALESCE(r.position_offset::double precision/NULLIF(length(d.original_text),0),0) DESC,d.id";
            case "duration" -> "COALESCE(r.reading_seconds,0) DESC,d.id";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестная сортировка");
        };
        int size=20, offset=page*size; UUID owner=owner(auth);String filterStatus="all".equals(status)?"":status;
        String search=q.strip().toLowerCase(Locale.ROOT),pattern="%"+search+"%";
        String where="d.user_id=? AND (?='' OR d.library_status=?) AND (?='' OR lower(d.title) LIKE ? OR lower(COALESCE(d.author,'')) LIKE ? OR EXISTS(SELECT 1 FROM book_genres g WHERE g.document_id=d.id AND lower(g.genre) LIKE ?))";
        var items=jdbc.query("SELECT d.id,d.title,d.author,d.source_type,d.original_filename,d.created_at,length(d.original_text),"+
                        "COALESCE(r.position_offset,0),COALESCE(j.status,'not_started'),EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover),"+
                        "d.library_status,r.last_read_at,COALESCE(r.reading_seconds,0) FROM documents d "+
                        "LEFT JOIN reading_progress r ON r.document_id=d.id AND r.user_id=d.user_id "+
                        "LEFT JOIN document_jobs j ON j.document_id=d.id WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?",
                (rs,n)-> { UUID bookId=rs.getObject(1,UUID.class);var lastRead=rs.getTimestamp(12);return new BookItem(bookId,rs.getString(2),rs.getString(3),genres(bookId),rs.getString(4),rs.getString(5),
                        rs.getTimestamp(6).toInstant(),rs.getInt(7),rs.getInt(8),rs.getString(9),rs.getBoolean(10),rs.getString(11),lastRead==null?null:lastRead.toInstant(),rs.getLong(13));},
                owner,filterStatus,filterStatus,search,pattern,pattern,pattern,size,offset);
        long total=Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM documents d WHERE "+where,Long.class,
                owner,filterStatus,filterStatus,search,pattern,pattern,pattern)).orElse(0L);
        return new BookPage(items,page,(int)Math.ceil(total/(double)size),total);
    }

    @PutMapping("/{id}/library") @Transactional LibraryMetadata saveLibrary(Authentication auth,@PathVariable UUID id,
                                                                             @Valid @RequestBody LibraryInput input) {
        owned(id,auth);String author=clean(input.author());
        var genres=new ArrayList<String>();
        for(String raw:input.genres()) {String genre=raw.strip();if(genres.stream().noneMatch(value->value.equalsIgnoreCase(genre))) genres.add(genre);}
        jdbc.update("UPDATE documents SET library_status=?,author=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",input.status(),author,id);
        jdbc.update("DELETE FROM book_genres WHERE document_id=?",id);
        for(String genre:genres) jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,?)",id,genre);
        return new LibraryMetadata(input.status(),author,genres);
    }

    @GetMapping("/{id}/manifest") Manifest manifest(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth); int length=doc.getOriginalText().length();
        structures.ensure(id,doc.getSourceType());
        var sections=jdbc.query("SELECT section_number,title,role,start_offset,end_offset,toc_level FROM reader_sections WHERE document_id=? ORDER BY section_number",
                (rs,n)->new Section(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5),rs.getInt(6)),id);
        if(sections.isEmpty()) {
            sections=jdbc.query("SELECT part_number,heading,start_offset,end_offset FROM document_parts WHERE document_id=? ORDER BY part_number",
                    (rs,n)->new Section(rs.getInt(1),rs.getString(2),"main",rs.getInt(3),rs.getInt(4),0),id);
            String preparation=jdbc.query("SELECT status FROM document_jobs WHERE document_id=?",rs->rs.next()?rs.getString(1):"not_started",id);
            if(!"ready".equals(preparation)) sections=List.of(new Section(-1,"Текст","main",0,length,0));
        }
        int position=jdbc.query("SELECT position_offset FROM reading_progress WHERE user_id=? AND document_id=?",
                rs->rs.next()?rs.getInt(1):0,owner(auth),id);
        var toc=jdbc.query("SELECT entry_number,title,role,toc_level,position_offset FROM reader_toc_entries WHERE document_id=? ORDER BY entry_number",
                (rs,n)->new TocEntry(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5)),id);
        if(toc.isEmpty()) toc=sections.stream().map(item->new TocEntry(item.number(),item.title(),item.role(),item.tocLevel(),item.startOffset())).toList();
        return new Manifest(id,doc.getTitle(),doc.getSourceType(),length,position,sections,toc);
    }

    @GetMapping("/{id}/sections/{number}") SectionContent section(Authentication auth,@PathVariable UUID id,@PathVariable int number) {
        Document doc=owned(id,auth);
        var structured=jdbc.query("SELECT title,role,start_offset,end_offset,content FROM reader_sections WHERE document_id=? AND section_number=?",
                (rs,n)->new SectionContent(number,rs.getString(1),rs.getString(2),rs.getInt(3),rs.getInt(4),rs.getString(5),sectionAssets(id,number)),id,number);
        if(!structured.isEmpty()) return structured.getFirst();
        var rows=jdbc.query("SELECT heading,start_offset,end_offset,content FROM document_parts WHERE document_id=? AND part_number=?",
                (rs,n)->new SectionContent(number,rs.getString(1),"main",rs.getInt(2),rs.getInt(3),rs.getString(4),List.of()),id,number);
        if(!rows.isEmpty()) return rows.getFirst();
        if(number==-1 || (number==0 && rows.isEmpty())) return new SectionContent(number,"Текст","main",0,doc.getOriginalText().length(),doc.getOriginalText(),List.of());
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping("/{id}/content") List<SectionContent> content(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth);
        structures.ensure(id,doc.getSourceType());
        var structured=jdbc.query("SELECT section_number,title,role,start_offset,end_offset,content FROM reader_sections WHERE document_id=? ORDER BY section_number",
                (rs,n)->new SectionContent(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5),rs.getString(6),sectionAssets(id,rs.getInt(1))),id);
        if(!structured.isEmpty()) return structured;
        var parts=jdbc.query("SELECT part_number,heading,start_offset,end_offset,content FROM document_parts WHERE document_id=? ORDER BY part_number",
                (rs,n)->new SectionContent(rs.getInt(1),rs.getString(2),"main",rs.getInt(3),rs.getInt(4),rs.getString(5),List.of()),id);
        if(!parts.isEmpty()) return parts;
        return List.of(new SectionContent(-1,"Текст","main",0,doc.getOriginalText().length(),doc.getOriginalText(),List.of()));
    }

    @GetMapping("/{id}/cover") ResponseEntity<byte[]> cover(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        var rows=jdbc.query("SELECT content,media_type FROM book_assets WHERE document_id=? AND is_cover ORDER BY id LIMIT 1",
                (rs,n)->new BinaryAsset(rs.getBytes(1),rs.getString(2)),id);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return image(rows.getFirst());
    }

    @GetMapping("/{id}/assets/{assetId}") ResponseEntity<byte[]> asset(Authentication auth,@PathVariable UUID id,@PathVariable UUID assetId) {
        owned(id,auth);
        var rows=jdbc.query("SELECT content,media_type FROM book_assets WHERE document_id=? AND id=?",
                (rs,n)->new BinaryAsset(rs.getBytes(1),rs.getString(2)),id,assetId);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return image(rows.getFirst());
    }

    @GetMapping("/{id}/progress") Progress progress(Authentication auth,@PathVariable UUID id) {
        owned(id,auth); UUID owner=owner(auth);
        var rows=jdbc.query("SELECT position_offset,confirmed_offset,version,reading_seconds,last_read_at,updated_at FROM reading_progress WHERE user_id=? AND document_id=?",
                (rs,n)-> {var lastRead=rs.getTimestamp(5);return new Progress(rs.getInt(1),rs.getInt(2),rs.getInt(3),rs.getLong(4),lastRead==null?null:lastRead.toInstant(),rs.getTimestamp(6).toInstant());},owner,id);
        return rows.isEmpty()?new Progress(0,0,0,0,null,Instant.EPOCH):rows.getFirst();
    }

    @PutMapping("/{id}/progress") @Transactional Progress saveProgress(Authentication auth,@PathVariable UUID id,@Valid @RequestBody ProgressInput input) {
        Document doc=owned(id,auth); UUID owner=owner(auth);
        if(input.positionOffset()>doc.getOriginalText().length() || (input.confirmedOffset()!=null && input.confirmedOffset()>doc.getOriginalText().length()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Позиция находится за пределами книги");
        int confirmed=input.confirmedOffset()==null?0:input.confirmedOffset(),elapsed=input.elapsedSeconds()==null?0:input.elapsedSeconds();
        jdbc.update("INSERT INTO reading_progress(user_id,document_id,position_offset,confirmed_offset,version,reading_seconds,last_read_at) VALUES (?,?,?,?,1,?,CURRENT_TIMESTAMP) "+
                        "ON CONFLICT(user_id,document_id) DO UPDATE SET position_offset=EXCLUDED.position_offset,"+
                        "confirmed_offset=GREATEST(reading_progress.confirmed_offset,EXCLUDED.confirmed_offset),"+
                        "reading_seconds=reading_progress.reading_seconds+EXCLUDED.reading_seconds,last_read_at=CURRENT_TIMESTAMP,"+
                        "version=reading_progress.version+1,updated_at=CURRENT_TIMESTAMP",
                owner,id,input.positionOffset(),confirmed,elapsed);
        jdbc.update("UPDATE documents SET library_status=CASE WHEN ? >= length(original_text) AND length(original_text)>0 THEN 'finished' "+
                "WHEN ?>0 AND library_status='want_to_read' THEN 'reading' ELSE library_status END WHERE id=?",input.positionOffset(),input.positionOffset(),id);
        return progress(auth,id);
    }

    @GetMapping("/{id}/bookmarks") List<Bookmark> bookmarks(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        return jdbc.query("SELECT id,position_offset,label,excerpt,created_at FROM reader_bookmarks WHERE user_id=? AND document_id=? ORDER BY position_offset",
                (rs,n)->new Bookmark(rs.getObject(1,UUID.class),rs.getInt(2),rs.getString(3),rs.getString(4),rs.getTimestamp(5).toInstant()),owner(auth),id);
    }
    @PostMapping("/{id}/bookmarks") @ResponseStatus(HttpStatus.CREATED) Bookmark addBookmark(Authentication auth,@PathVariable UUID id,@Valid @RequestBody BookmarkInput input) {
        Document doc=owned(id,auth); if(input.positionOffset()>doc.getOriginalText().length()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        UUID bookmarkId=UUID.randomUUID(); Instant now=Instant.now();
        jdbc.update("INSERT INTO reader_bookmarks(id,user_id,document_id,position_offset,label,excerpt,created_at) VALUES (?,?,?,?,?,?,?)",
                bookmarkId,owner(auth),id,input.positionOffset(),clean(input.label()),input.excerpt().strip(),java.sql.Timestamp.from(now));
        return new Bookmark(bookmarkId,input.positionOffset(),clean(input.label()),input.excerpt().strip(),now);
    }
    @DeleteMapping("/{id}/bookmarks/{bookmarkId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeBookmark(Authentication auth,@PathVariable UUID id,@PathVariable UUID bookmarkId) {
        owned(id,auth); if(jdbc.update("DELETE FROM reader_bookmarks WHERE id=? AND document_id=? AND user_id=?",bookmarkId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping("/{id}/highlights") List<Highlight> highlights(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        return jdbc.query("SELECT id,start_offset,end_offset,color,exact_text,note,created_at FROM reader_highlights WHERE user_id=? AND document_id=? ORDER BY start_offset",
                (rs,n)->new Highlight(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4),rs.getString(5),rs.getString(6),rs.getTimestamp(7).toInstant()),owner(auth),id);
    }
    @PostMapping("/{id}/highlights") @ResponseStatus(HttpStatus.CREATED) Highlight addHighlight(Authentication auth,@PathVariable UUID id,@Valid @RequestBody HighlightInput input) {
        Document doc=owned(id,auth);
        if(input.endOffset()<=input.startOffset() || input.endOffset()>doc.getOriginalText().length() || input.exactText().length()!=input.endOffset()-input.startOffset())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Некорректный диапазон выделения");
        String actual=doc.getOriginalText().substring(input.startOffset(),input.endOffset());
        if(!actual.equals(input.exactText())) throw new ResponseStatusException(HttpStatus.CONFLICT,"Текст книги изменился");
        UUID highlightId=UUID.randomUUID(); Instant now=Instant.now(); String color=input.color()==null?"yellow":input.color();
        jdbc.update("INSERT INTO reader_highlights(id,user_id,document_id,start_offset,end_offset,color,exact_text,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                highlightId,owner(auth),id,input.startOffset(),input.endOffset(),color,input.exactText(),clean(input.note()),java.sql.Timestamp.from(now));
        return new Highlight(highlightId,input.startOffset(),input.endOffset(),color,input.exactText(),clean(input.note()),now);
    }
    @DeleteMapping("/{id}/highlights/{highlightId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeHighlight(Authentication auth,@PathVariable UUID id,@PathVariable UUID highlightId) {
        owned(id,auth); if(jdbc.update("DELETE FROM reader_highlights WHERE id=? AND document_id=? AND user_id=?",highlightId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping("/{id}/original") ResponseEntity<byte[]> original(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth);
        var rows=jdbc.query("SELECT original_file FROM documents WHERE id=?",(rs,n)->rs.getBytes(1),id);
        byte[] data=rows.isEmpty()?null:rows.getFirst();
        if(data==null) data=doc.getOriginalText().getBytes(StandardCharsets.UTF_8);
        MediaType type=switch(doc.getSourceType()) {
            case "pdf" -> MediaType.APPLICATION_PDF;
            case "epub" -> MediaType.parseMediaType("application/epub+zip");
            case "fb2" -> MediaType.APPLICATION_XML;
            case "docx" -> MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            default -> MediaType.TEXT_PLAIN;
        };
        String filename=doc.getOriginalFilename()==null?doc.getTitle()+".txt":doc.getOriginalFilename();
        return ResponseEntity.ok().contentType(type).header(HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.inline().filename(filename,StandardCharsets.UTF_8).build().toString()).body(data);
    }

    private String clean(String value) { return value==null || value.isBlank()?null:value.strip(); }
    private record BinaryAsset(byte[] content,String mediaType) {}
    private List<String> genres(UUID id) { return jdbc.query("SELECT genre FROM book_genres WHERE document_id=? ORDER BY lower(genre)",(rs,n)->rs.getString(1),id); }
    private List<Asset> sectionAssets(UUID id,int number) {
        return jdbc.query("SELECT a.id,a.media_type FROM reader_section_assets r JOIN book_assets a ON a.id=r.asset_id WHERE r.document_id=? AND r.section_number=? ORDER BY r.order_index",
                (rs,n)->new Asset(rs.getObject(1,UUID.class),rs.getString(2)),id,number);
    }
    private ResponseEntity<byte[]> image(BinaryAsset asset) {
        if(asset.mediaType()==null || !asset.mediaType().startsWith("image/")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        MediaType type;
        try { type=MediaType.parseMediaType(asset.mediaType()); } catch(IllegalArgumentException ignored) { type=MediaType.APPLICATION_OCTET_STREAM; }
        return ResponseEntity.ok().contentType(type).header(HttpHeaders.CACHE_CONTROL,"private, max-age=86400").body(asset.content());
    }
    private UUID owner(Authentication auth) { return UUID.fromString(auth.getName()); }
    private Document owned(UUID id,Authentication auth) {
        return documents.findByIdAndUserId(id,owner(auth)).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}

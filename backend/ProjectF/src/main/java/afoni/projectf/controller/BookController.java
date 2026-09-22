package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.service.BookTextExtractor;
import afoni.projectf.service.OfficePreviewService;
import afoni.projectf.service.ReaderStructureService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/books")
public class BookController {
    private final DocumentRepository documents;
    private final JdbcTemplate jdbc;
    private final ReaderStructureService structures;
    private final BookTextExtractor extractor;
    private final OfficePreviewService previews;

    public BookController(DocumentRepository documents,JdbcTemplate jdbc,ReaderStructureService structures,
                          BookTextExtractor extractor,OfficePreviewService previews) {
        this.documents=documents;this.jdbc=jdbc;this.structures=structures;this.extractor=extractor;this.previews=previews;
    }

    record BookItem(UUID id,String title,String author,List<String> genres,String format,String filename,Long fileSizeBytes,
                    Instant createdAt,Instant updatedAt,int textLength,int positionOffset,String preparation,boolean hasCover,
                    boolean favorite,UUID collectionId,String libraryStatus,Instant lastReadAt,long readingSeconds) {}
    record BookPage(List<BookItem> items,int page,int totalPages,long totalElements) {}
    record LibraryFacets(List<String> formats,List<String> genres) {}
    record BookDetails(UUID id,String title,String author,List<String> genres,String format,String filename,
                      Long fileSizeBytes,String publisher,String publicationDate,String language,String description,
                       Instant createdAt,Instant updatedAt,boolean hasCover,boolean favorite,UUID collectionId,String originalSha256,
                       int textLength,int sectionCount,int assetCount,String preparationStatus,Integer processedCharacters,
                       Integer totalCharacters,String importError) {}
    record BookDetailsInput(@NotBlank @Size(max=200) String title,@Size(max=500) String author,
                            @Size(max=500) String publisher,@Size(max=255) String publicationDate,
                            @Size(max=100) String language,
                            @NotNull @Size(max=12) List<@NotBlank @Size(max=60) String> genres,
                            @Size(max=50000) String description) {}
    record Section(int number,String title,String role,int startOffset,int endOffset,int tocLevel) {}
    record TocEntry(int number,String title,String role,int level,int positionOffset) {}
    record Manifest(UUID id,String title,String format,int textLength,int positionOffset,List<Section> sections,List<TocEntry> toc) {}
    record Asset(UUID id,String mediaType) {}
    record SectionLink(int startOffset,int endOffset,int targetSectionNumber,int targetSectionOffset,int targetPositionOffset,String kind) {}
    record SectionContent(int number,String title,String role,int startOffset,int endOffset,String content,List<Asset> assets,List<SectionLink> links) {}
    record SearchItem(long index,int sectionNumber,int sectionOffset,int positionOffset,int length,String excerpt,
                      int excerptMatchStart,int excerptMatchEnd) {}
    record SearchResult(String query,long total,int offset,int limit,List<SearchItem> items) {}
    record ProgressInput(@Min(0) int positionOffset,@Min(0) Integer confirmedOffset,@Min(0) Integer version,
                         @Min(-1) Integer sectionNumber,@Min(0) Integer sectionOffset,
                         @Min(0) @Max(604800) Integer elapsedSeconds,UUID sessionId,
                         @Min(0) @Max(604800) Integer sessionElapsedSeconds) {}
    record Progress(int positionOffset,int confirmedOffset,int version,Integer sectionNumber,int sectionOffset,
                    long readingSeconds,Instant lastReadAt,Instant updatedAt) {}
    record LibraryInput(@NotBlank @Pattern(regexp="want_to_read|reading|finished") String status,
                        @Size(max=500) String author,@NotNull @Size(max=12) List<@NotBlank @Size(max=60) String> genres) {}
    record LibraryMetadata(String status,String author,List<String> genres) {}
    record FavoriteInput(@NotNull Boolean favorite) {}
    record BulkStatusInput(@NotEmpty @Size(max=100) List<@NotNull UUID> ids,
                           @NotBlank @Pattern(regexp="want_to_read|reading|finished") String status) {}
    record CollectionInput(@NotBlank @Size(max=80) String name) {}
    record CollectionMoveInput(@NotEmpty @Size(max=100) List<@NotNull UUID> ids,UUID collectionId) {}
    record BookCollection(UUID id,String name,long bookCount,Instant createdAt,Instant updatedAt) {}
    record BookmarkInput(@Min(0) int positionOffset,@Size(max=160) String label,@NotBlank @Size(max=300) String excerpt) {}
    record BookmarkUpdate(@Size(max=160) String label) {}
    record Bookmark(UUID id,int positionOffset,String label,String excerpt,Instant createdAt,Instant updatedAt) {}
    record HighlightInput(@Min(0) int startOffset,@Min(1) int endOffset,@Pattern(regexp="yellow|green|blue|pink") String color,
                          @Size(max=10000) String exactText,@Size(max=2000) String note) {}
    record HighlightUpdate(@NotNull @Pattern(regexp="yellow|green|blue|pink") String color,@Size(max=2000) String note) {}
    record Highlight(UUID id,int startOffset,int endOffset,String color,String exactText,String note,Instant createdAt,Instant updatedAt) {}

    @GetMapping("/{id}/details") BookDetails details(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        return jdbc.query("SELECT d.id,d.title,d.author,d.source_type,d.original_filename,d.original_size,d.publisher,d.publication_date,"+
                        "d.language,d.description,d.created_at,d.updated_at,EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover),"+
                        "d.favorite,d.collection_id,d.original_sha256,length(d.original_text),(SELECT count(*) FROM reader_sections s WHERE s.document_id=d.id),"+
                        "(SELECT count(*) FROM book_assets a WHERE a.document_id=d.id),COALESCE(j.status,'not_started'),j.next_offset,j.total_characters,j.error_message "+
                        "FROM documents d LEFT JOIN document_jobs j ON j.document_id=d.id WHERE d.id=?",
                rs->{if(!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);return new BookDetails(
                        rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),genres(id),rs.getString(4),rs.getString(5),
                        (Long)rs.getObject(6),rs.getString(7),rs.getString(8),rs.getString(9),rs.getString(10),
                        rs.getTimestamp(11).toInstant(),rs.getTimestamp(12).toInstant(),rs.getBoolean(13),rs.getBoolean(14),
                        rs.getObject(15,UUID.class),rs.getString(16),rs.getInt(17),rs.getInt(18),rs.getInt(19),rs.getString(20),(Integer)rs.getObject(21),
                        (Integer)rs.getObject(22),rs.getString(23));},id);
    }

    @PutMapping("/{id}/details") @Transactional BookDetails saveDetails(Authentication auth,@PathVariable UUID id,
                                                                         @Valid @RequestBody BookDetailsInput input) {
        owned(id,auth);
        var normalizedGenres=new ArrayList<String>();
        for(String raw:input.genres()) {String genre=raw.strip();if(normalizedGenres.stream().noneMatch(value->value.equalsIgnoreCase(genre))) normalizedGenres.add(genre);}
        jdbc.update("UPDATE documents SET title=?,author=?,publisher=?,publication_date=?,language=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                input.title().strip(),clean(input.author()),clean(input.publisher()),clean(input.publicationDate()),clean(input.language()),clean(input.description()),id);
        jdbc.update("DELETE FROM book_genres WHERE document_id=?",id);
        for(String genre:normalizedGenres) jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,?)",id,genre);
        return details(auth,id);
    }

    @PostMapping("/{id}/details/refresh") @Transactional BookDetails refreshDetails(Authentication auth,@PathVariable UUID id) {
        Document document=owned(id,auth);
        if(!Set.of("epub","fb2").contains(document.getSourceType()))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,"Формат книги не содержит поддерживаемых метаданных");
        var sources=jdbc.query("SELECT original_file FROM documents WHERE id=?",(rs,n)->rs.getBytes(1),id);
        byte[] source=sources.isEmpty()?null:sources.getFirst();
        if(source==null || source.length==0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Исходный файл книги недоступен");
        BookTextExtractor.ExtractedBook book;
        try { book=extractor.extractBook(source,document.getSourceType()); }
        catch(ResponseStatusException error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,"Не удалось повторно прочитать метаданные книги",error);
        }
        if(!structures.refreshDetails(id,book))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,"В исходном файле нет поддерживаемых метаданных");
        return details(auth,id);
    }

    @GetMapping("/{id}/search") SearchResult search(Authentication auth,@PathVariable UUID id,@RequestParam String q,
                                                     @RequestParam(defaultValue="0") int offset,
                                                     @RequestParam(defaultValue="20") int limit) {
        Document document=owned(id,auth);String query=q.strip();
        if(query.length()<2 || query.length()>200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Поисковый запрос должен содержать от 2 до 200 символов");
        if(offset<0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Смещение поиска не может быть отрицательным");
        if(limit<1 || limit>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Размер страницы поиска должен быть от 1 до 100");
        structures.ensure(id,document.getSourceType());
        var sections=jdbc.query("SELECT section_number,start_offset,content FROM reader_sections WHERE document_id=? ORDER BY section_number",
                (rs,n)->new SearchSection(rs.getInt(1),rs.getInt(2),rs.getString(3)),id);
        java.util.regex.Pattern pattern=java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(query),
                java.util.regex.Pattern.CASE_INSENSITIVE|java.util.regex.Pattern.UNICODE_CASE);
        var items=new ArrayList<SearchItem>();long index=0,upper=(long)offset+limit;
        for(var section:sections) {
            var matcher=pattern.matcher(section.content());
            while(matcher.find()) {
                if(index>=offset && index<upper) {
                    Excerpt excerpt=excerpt(section.content(),matcher.start(),matcher.end());
                    items.add(new SearchItem(index,section.number(),matcher.start(),section.startOffset()+matcher.start(),
                            matcher.end()-matcher.start(),excerpt.text(),matcher.start()-excerpt.start(),matcher.end()-excerpt.start()));
                }
                index++;
            }
        }
        return new SearchResult(query,index,offset,limit,items);
    }

    @GetMapping BookPage list(Authentication auth,@RequestParam(defaultValue="0") int page,
                              @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="all") String status,
                              @RequestParam(defaultValue="all") String format,@RequestParam(defaultValue="") String genre,
                              @RequestParam(defaultValue="all") String favorite,@RequestParam(defaultValue="recent") String sort,
                              @RequestParam(defaultValue="default") String direction,
                              @RequestParam(defaultValue="all") String collection) {
        if(page<0 || page>100000 || q.length()>100 || genre.length()>60) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if(!Set.of("all","want_to_read","reading","finished").contains(status)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестный статус книги");
        if(!Set.of("all","manual","txt","md","epub","fb2","pdf","docx").contains(format)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестный формат книги");
        if(!Set.of("all","yes").contains(favorite)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестный фильтр избранного");
        String defaultDirection=Set.of("title","author").contains(sort)?"asc":"desc";
        String actualDirection="default".equals(direction)?defaultDirection:direction;
        if(!Set.of("asc","desc").contains(actualDirection)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестное направление сортировки");
        String expression=switch(sort) {
            case "recent" -> "COALESCE(r.last_read_at,d.created_at)";
            case "added" -> "d.created_at";
            case "title" -> "lower(d.title)";
            case "author" -> "lower(COALESCE(d.author,''))";
            case "progress" -> "COALESCE(r.position_offset::double precision/NULLIF(length(d.original_text),0),0)";
            case "duration" -> "COALESCE(r.reading_seconds,0)";
            case "size" -> "COALESCE(d.original_size,length(d.original_text))";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестная сортировка");
        };
        String order=expression+" "+actualDirection+",lower(d.title),d.id";
        int size=20, offset=page*size; UUID owner=owner(auth);String filterStatus="all".equals(status)?"":status;
        String filterFormat="all".equals(format)?"":format,filterGenre=genre.strip().toLowerCase(Locale.ROOT);
        boolean onlyFavorite="yes".equals(favorite);
        String search=q.strip().toLowerCase(Locale.ROOT),pattern="%"+search+"%";
        String where="d.user_id=? AND d.material_type='BOOK' AND (?='' OR d.library_status=?) AND (?='' OR d.source_type=?) AND (NOT ? OR d.favorite) "+
                "AND (?='' OR EXISTS(SELECT 1 FROM book_genres fg WHERE fg.document_id=d.id AND lower(fg.genre)=?)) "+
                "AND (?='' OR lower(d.title) LIKE ? OR lower(COALESCE(d.author,'')) LIKE ? OR EXISTS(SELECT 1 FROM book_genres g WHERE g.document_id=d.id AND lower(g.genre) LIKE ?))";
        var args=new ArrayList<Object>(List.of(owner,filterStatus,filterStatus,filterFormat,filterFormat,onlyFavorite,filterGenre,filterGenre,search,pattern,pattern,pattern));
        if("none".equals(collection)) where+=" AND d.collection_id IS NULL";
        else if(!"all".equals(collection)) {
            UUID collectionId;
            try { collectionId=UUID.fromString(collection); }
            catch(IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестная коллекция"); }
            collectionOwned(collectionId,owner);where+=" AND d.collection_id=?";args.add(collectionId);
        }
        var items=jdbc.query("SELECT d.id,d.title,d.author,d.source_type,d.original_filename,d.original_size,d.created_at,d.updated_at,length(d.original_text),"+
                        "COALESCE(r.position_offset,0),COALESCE(j.status,'not_started'),EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover),"+
                        "d.favorite,d.collection_id,d.library_status,r.last_read_at,COALESCE(r.reading_seconds,0) FROM documents d "+
                        "LEFT JOIN reading_progress r ON r.document_id=d.id AND r.user_id=d.user_id "+
                        "LEFT JOIN document_jobs j ON j.document_id=d.id WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?",
                (rs,n)-> { UUID bookId=rs.getObject(1,UUID.class);var lastRead=rs.getTimestamp(16);return new BookItem(bookId,rs.getString(2),rs.getString(3),genres(bookId),rs.getString(4),rs.getString(5),(Long)rs.getObject(6),
                        rs.getTimestamp(7).toInstant(),rs.getTimestamp(8).toInstant(),rs.getInt(9),rs.getInt(10),rs.getString(11),rs.getBoolean(12),rs.getBoolean(13),rs.getObject(14,UUID.class),rs.getString(15),lastRead==null?null:lastRead.toInstant(),rs.getLong(17));},
                concat(args.toArray(),size,offset));
        long total=Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM documents d WHERE "+where,Long.class,args.toArray())).orElse(0L);
        return new BookPage(items,page,(int)Math.ceil(total/(double)size),total);
    }

    @GetMapping("/facets") LibraryFacets facets(Authentication auth) {
        UUID user=owner(auth);
        return new LibraryFacets(
                jdbc.query("SELECT DISTINCT source_type FROM documents WHERE user_id=? AND material_type='BOOK' ORDER BY source_type",(rs,n)->rs.getString(1),user),
                jdbc.query("SELECT min(g.genre) FROM book_genres g JOIN documents d ON d.id=g.document_id WHERE d.user_id=? AND d.material_type='BOOK' GROUP BY lower(g.genre) ORDER BY lower(g.genre)",(rs,n)->rs.getString(1),user));
    }

    @GetMapping("/collections") List<BookCollection> collections(Authentication auth) {
        return jdbc.query("SELECT c.id,c.name,count(d.id),c.created_at,c.updated_at FROM book_collections c "+
                        "LEFT JOIN documents d ON d.collection_id=c.id AND d.material_type='BOOK' WHERE c.user_id=? GROUP BY c.id ORDER BY lower(c.name),c.id",
                (rs,n)->new BookCollection(rs.getObject(1,UUID.class),rs.getString(2),rs.getLong(3),rs.getTimestamp(4).toInstant(),rs.getTimestamp(5).toInstant()),owner(auth));
    }

    @PostMapping("/collections") @ResponseStatus(HttpStatus.CREATED)
    BookCollection createCollection(Authentication auth,@Valid @RequestBody CollectionInput input) {
        UUID user=owner(auth),id=UUID.randomUUID();String name=input.name().strip();ensureCollectionNameAvailable(user,null,name);
        jdbc.update("INSERT INTO book_collections(id,user_id,name) VALUES (?,?,?)",id,user,name);
        return collectionOwned(id,user);
    }

    @PutMapping("/collections/{collectionId}")
    BookCollection renameCollection(Authentication auth,@PathVariable UUID collectionId,@Valid @RequestBody CollectionInput input) {
        UUID user=owner(auth);collectionOwned(collectionId,user);String name=input.name().strip();ensureCollectionNameAvailable(user,collectionId,name);
        jdbc.update("UPDATE book_collections SET name=? WHERE id=?",name,collectionId);
        return collectionOwned(collectionId,user);
    }

    @DeleteMapping("/collections/{collectionId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteCollection(Authentication auth,@PathVariable UUID collectionId) {
        UUID user=owner(auth);collectionOwned(collectionId,user);jdbc.update("DELETE FROM book_collections WHERE id=?",collectionId);
    }

    @PutMapping("/bulk-collection") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void moveToCollection(Authentication auth,@Valid @RequestBody CollectionMoveInput input) {
        UUID user=owner(auth);if(input.collectionId()!=null) collectionOwned(input.collectionId(),user);
        var ids=new LinkedHashSet<>(input.ids());String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        var ownershipArgs=new ArrayList<Object>();ownershipArgs.add(user);ownershipArgs.addAll(ids);
        long found=Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM documents WHERE user_id=? AND material_type='BOOK' AND id IN ("+placeholders+")",Long.class,ownershipArgs.toArray())).orElse(0L);
        if(found!=ids.size()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Одна или несколько книг недоступны");
        var updateArgs=new ArrayList<Object>();updateArgs.add(input.collectionId());updateArgs.addAll(ids);
        jdbc.update("UPDATE documents SET collection_id=?,updated_at=CURRENT_TIMESTAMP WHERE id IN ("+placeholders+")",updateArgs.toArray());
    }

    @PutMapping("/{id}/library") @Transactional LibraryMetadata saveLibrary(Authentication auth,@PathVariable UUID id,
                                                                             @Valid @RequestBody LibraryInput input) {
        owned(id,auth);String author=clean(input.author());
        var genres=new ArrayList<String>();
        for(String raw:input.genres()) {String genre=raw.strip();if(genres.stream().noneMatch(value->value.equalsIgnoreCase(genre))) genres.add(genre);}
        jdbc.update("UPDATE documents SET library_status=?,author=?,finished_at=CASE WHEN ?='finished' THEN COALESCE(finished_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                input.status(),author,input.status(),id);
        jdbc.update("DELETE FROM book_genres WHERE document_id=?",id);
        for(String genre:genres) jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,?)",id,genre);
        return new LibraryMetadata(input.status(),author,genres);
    }

    @PutMapping("/{id}/favorite") @ResponseStatus(HttpStatus.NO_CONTENT)
    void saveFavorite(Authentication auth,@PathVariable UUID id,@Valid @RequestBody FavoriteInput input) {
        owned(id,auth);jdbc.update("UPDATE documents SET favorite=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",input.favorite(),id);
    }

    @PutMapping("/bulk-status") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void bulkStatus(Authentication auth,@Valid @RequestBody BulkStatusInput input) {
        UUID user=owner(auth);var ids=new LinkedHashSet<>(input.ids());
        String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        int changed=jdbc.update("UPDATE documents SET library_status=?,finished_at=CASE WHEN ?='finished' THEN COALESCE(finished_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND material_type='BOOK' AND id IN ("+placeholders+")",
                concat(new Object[]{input.status(),input.status(),user},ids.toArray()));
        if(changed!=ids.size()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Одна или несколько книг недоступны");
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
                (rs,n)->new SectionContent(number,rs.getString(1),rs.getString(2),rs.getInt(3),rs.getInt(4),rs.getString(5),sectionAssets(id,number),sectionLinks(id,number)),id,number);
        if(!structured.isEmpty()) return structured.getFirst();
        var rows=jdbc.query("SELECT heading,start_offset,end_offset,content FROM document_parts WHERE document_id=? AND part_number=?",
                (rs,n)->new SectionContent(number,rs.getString(1),"main",rs.getInt(2),rs.getInt(3),rs.getString(4),List.of(),List.of()),id,number);
        if(!rows.isEmpty()) return rows.getFirst();
        if(number==-1 || (number==0 && rows.isEmpty())) return new SectionContent(number,"Текст","main",0,doc.getOriginalText().length(),doc.getOriginalText(),List.of(),List.of());
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping("/{id}/content") List<SectionContent> content(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth);
        structures.ensure(id,doc.getSourceType());
        var structured=jdbc.query("SELECT section_number,title,role,start_offset,end_offset,content FROM reader_sections WHERE document_id=? ORDER BY section_number",
                (rs,n)->new SectionContent(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5),rs.getString(6),sectionAssets(id,rs.getInt(1)),sectionLinks(id,rs.getInt(1))),id);
        if(!structured.isEmpty()) return structured;
        var parts=jdbc.query("SELECT part_number,heading,start_offset,end_offset,content FROM document_parts WHERE document_id=? ORDER BY part_number",
                (rs,n)->new SectionContent(rs.getInt(1),rs.getString(2),"main",rs.getInt(3),rs.getInt(4),rs.getString(5),List.of(),List.of()),id);
        if(!parts.isEmpty()) return parts;
        return List.of(new SectionContent(-1,"Текст","main",0,doc.getOriginalText().length(),doc.getOriginalText(),List.of(),List.of()));
    }

    @GetMapping("/{id}/cover") ResponseEntity<byte[]> cover(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        var rows=jdbc.query("SELECT content,media_type FROM book_assets WHERE document_id=? AND is_cover ORDER BY id LIMIT 1",
                (rs,n)->new BinaryAsset(rs.getBytes(1),rs.getString(2)),id);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return image(rows.getFirst());
    }

    @PutMapping(value="/{id}/cover",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @Transactional BookDetails saveCover(
            Authentication auth,@PathVariable UUID id,@RequestPart("file") MultipartFile file) {
        owned(id,auth);
        if(file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите файл обложки");
        if(file.getSize()>5L*1024*1024) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Обложка должна быть не больше 5 МБ");
        byte[] bytes;
        try { bytes=file.getBytes(); }
        catch(Exception error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Не удалось прочитать обложку",error); }
        String mediaType=file.getContentType();
        if(!Set.of(MediaType.IMAGE_JPEG_VALUE,MediaType.IMAGE_PNG_VALUE,MediaType.IMAGE_GIF_VALUE).contains(mediaType))
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"Поддерживаются JPG, PNG и GIF");
        try {
            var image=ImageIO.read(new ByteArrayInputStream(bytes));
            if(image==null || image.getWidth()<1 || image.getHeight()<1 || image.getWidth()>10000 || image.getHeight()>10000)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Файл не является корректным изображением");
        } catch(ResponseStatusException error) { throw error; }
        catch(Exception error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Файл не является корректным изображением",error); }
        jdbc.update("UPDATE book_assets SET is_cover=FALSE WHERE document_id=?",id);
        jdbc.update("INSERT INTO book_assets(id,document_id,source_path,media_type,content,is_cover) VALUES (?,?,?,?,?,TRUE) "+
                        "ON CONFLICT(document_id,source_path) DO UPDATE SET media_type=EXCLUDED.media_type,content=EXCLUDED.content,is_cover=TRUE",
                UUID.randomUUID(),id,"__manual_cover__",mediaType,bytes);
        jdbc.update("UPDATE documents SET updated_at=CURRENT_TIMESTAMP WHERE id=?",id);
        return details(auth,id);
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
        var rows=jdbc.query("SELECT position_offset,confirmed_offset,version,section_number,section_offset,reading_seconds,last_read_at,updated_at FROM reading_progress WHERE user_id=? AND document_id=?",
                (rs,n)-> {var lastRead=rs.getTimestamp(7);Integer section=(Integer)rs.getObject(4);return new Progress(rs.getInt(1),rs.getInt(2),rs.getInt(3),section,rs.getInt(5),rs.getLong(6),lastRead==null?null:lastRead.toInstant(),rs.getTimestamp(8).toInstant());},owner,id);
        return rows.isEmpty()?new Progress(0,0,0,null,0,0,null,Instant.EPOCH):rows.getFirst();
    }

    @PutMapping("/{id}/progress") @Transactional Progress saveProgress(Authentication auth,@PathVariable UUID id,@Valid @RequestBody ProgressInput input) {
        Document doc=owned(id,auth); UUID owner=owner(auth);
        if(input.positionOffset()>doc.getOriginalText().length() || (input.confirmedOffset()!=null && input.confirmedOffset()>doc.getOriginalText().length()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Позиция находится за пределами книги");
        var current=jdbc.query("SELECT version,position_offset,confirmed_offset FROM reading_progress WHERE user_id=? AND document_id=? FOR UPDATE",
                (rs,n)->new ProgressState(rs.getInt(1),rs.getInt(2),rs.getInt(3)),owner,id);
        int expected=input.version()==null?0:input.version();
        if(!current.isEmpty() && input.version()!=null && current.getFirst().version()!=expected)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Позиция уже изменена в другой вкладке");
        if(current.isEmpty() && input.version()!=null && expected!=0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Позиция уже изменена в другой вкладке");
        var anchor=resolveProgressAnchor(id,input,doc.getOriginalText().length());
        int confirmed=input.confirmedOffset()==null?0:input.confirmedOffset();
        int previousPosition=current.isEmpty()?0:current.getFirst().positionOffset(),previousConfirmed=current.isEmpty()?0:current.getFirst().confirmedOffset();
        int elapsed=recordReadingSession(owner,id,input,previousPosition,anchor.positionOffset(),previousConfirmed,confirmed);
        if(current.isEmpty()) {
            int inserted=jdbc.update("INSERT INTO reading_progress(user_id,document_id,position_offset,confirmed_offset,version,section_number,section_offset,reading_seconds,last_read_at) VALUES (?,?,?,?,1,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,document_id) DO NOTHING",
                    owner,id,anchor.positionOffset(),confirmed,anchor.sectionNumber(),anchor.sectionOffset(),elapsed);
            if(inserted==0 && input.version()!=null)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Позиция уже изменена в другой вкладке");
            if(inserted==0)
                jdbc.update("UPDATE reading_progress SET position_offset=?,confirmed_offset=GREATEST(confirmed_offset,?),version=version+1,"+
                                "section_number=?,section_offset=?,reading_seconds=reading_seconds+?,last_read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND document_id=?",
                        anchor.positionOffset(),confirmed,anchor.sectionNumber(),anchor.sectionOffset(),elapsed,owner,id);
        } else {
            jdbc.update("UPDATE reading_progress SET position_offset=?,confirmed_offset=GREATEST(confirmed_offset,?),version=version+1,"+
                            "section_number=?,section_offset=?,reading_seconds=reading_seconds+?,last_read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND document_id=?",
                    anchor.positionOffset(),confirmed,anchor.sectionNumber(),anchor.sectionOffset(),elapsed,owner,id);
        }
        jdbc.update("UPDATE documents SET library_status=CASE WHEN ? >= length(original_text) AND length(original_text)>0 THEN 'finished' "+
                        "WHEN ?>0 AND library_status='want_to_read' THEN 'reading' ELSE library_status END,"+
                        "finished_at=CASE WHEN ? >= length(original_text) AND length(original_text)>0 THEN COALESCE(finished_at,CURRENT_TIMESTAMP) ELSE finished_at END WHERE id=?",
                anchor.positionOffset(),anchor.positionOffset(),anchor.positionOffset(),id);
        return progress(auth,id);
    }

    private record ProgressState(int version,int positionOffset,int confirmedOffset) {}
    private record ReadingSessionState(UUID userId,UUID documentId,int durationSeconds,int lastConfirmedOffset) {}
    private int recordReadingSession(UUID user,UUID documentId,ProgressInput input,int startOffset,int endOffset,
                                     int previousConfirmed,int confirmedOffset) {
        int fallback=input.elapsedSeconds()==null?0:input.elapsedSeconds();
        int total=input.sessionElapsedSeconds()==null?fallback:input.sessionElapsedSeconds();
        if(total<=0) return 0;
        UUID sessionId=input.sessionId()==null?UUID.randomUUID():input.sessionId();
        var existing=jdbc.query("SELECT user_id,document_id,duration_seconds,last_confirmed_offset FROM reading_sessions WHERE id=? FOR UPDATE",
                (rs,n)->new ReadingSessionState(rs.getObject(1,UUID.class),rs.getObject(2,UUID.class),rs.getInt(3),rs.getInt(4)),sessionId);
        if(existing.isEmpty()) {
            long characters=Math.max(0,confirmedOffset-previousConfirmed);
            jdbc.update("INSERT INTO reading_sessions(id,user_id,document_id,started_at,ended_at,duration_seconds,start_offset,end_offset,last_confirmed_offset,characters_read) "+
                            "VALUES (?,?,?,CURRENT_TIMESTAMP-(? * INTERVAL '1 second'),CURRENT_TIMESTAMP,?,?,?,?,?)",
                    sessionId,user,documentId,total,total,startOffset,endOffset,confirmedOffset,characters);
            return total;
        }
        var session=existing.getFirst();
        if(!session.userId().equals(user) || !session.documentId().equals(documentId))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Сессия чтения уже используется");
        int increment=Math.max(0,total-session.durationSeconds());
        long characters=Math.max(0,confirmedOffset-session.lastConfirmedOffset());
        jdbc.update("UPDATE reading_sessions SET ended_at=CURRENT_TIMESTAMP,duration_seconds=GREATEST(duration_seconds,?),end_offset=?,"+
                        "last_confirmed_offset=GREATEST(last_confirmed_offset,?),characters_read=characters_read+? WHERE id=?",
                total,endOffset,confirmedOffset,characters,sessionId);
        return increment;
    }
    private record ProgressAnchor(int positionOffset,Integer sectionNumber,int sectionOffset) {}
    private ProgressAnchor resolveProgressAnchor(UUID documentId,ProgressInput input,int textLength) {
        if(input.sectionNumber()==null) {
            var rows=jdbc.query("SELECT section_number,start_offset,end_offset FROM reader_sections WHERE document_id=? AND start_offset<=? ORDER BY start_offset DESC LIMIT 1",
                    (rs,n)->new int[]{rs.getInt(1),rs.getInt(2),rs.getInt(3)},documentId,input.positionOffset());
            if(rows.isEmpty()) return new ProgressAnchor(input.positionOffset(),null,0);
            var row=rows.getFirst();return new ProgressAnchor(input.positionOffset(),row[0],Math.min(row[2]-row[1],Math.max(0,input.positionOffset()-row[1])));
        }
        var rows=jdbc.query("SELECT start_offset,end_offset FROM reader_sections WHERE document_id=? AND section_number=?",
                (rs,n)->new int[]{rs.getInt(1),rs.getInt(2)},documentId,input.sectionNumber());
        if(rows.isEmpty()) {
            if(input.sectionNumber()==-1) return new ProgressAnchor(Math.min(textLength,input.positionOffset()),-1,Math.min(textLength,input.sectionOffset()==null?input.positionOffset():input.sectionOffset()));
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Раздел книги не найден");
        }
        var row=rows.getFirst();int local=Math.min(row[1]-row[0],input.sectionOffset()==null?Math.max(0,input.positionOffset()-row[0]):input.sectionOffset());
        return new ProgressAnchor(row[0]+local,input.sectionNumber(),local);
    }

    @GetMapping("/{id}/bookmarks") List<Bookmark> bookmarks(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        return jdbc.query("SELECT id,position_offset,label,excerpt,created_at,updated_at FROM reader_bookmarks WHERE user_id=? AND document_id=? ORDER BY position_offset",
                (rs,n)->new Bookmark(rs.getObject(1,UUID.class),rs.getInt(2),rs.getString(3),rs.getString(4),rs.getTimestamp(5).toInstant(),rs.getTimestamp(6).toInstant()),owner(auth),id);
    }
    @PostMapping("/{id}/bookmarks") @ResponseStatus(HttpStatus.CREATED) Bookmark addBookmark(Authentication auth,@PathVariable UUID id,@Valid @RequestBody BookmarkInput input) {
        Document doc=owned(id,auth); if(input.positionOffset()>doc.getOriginalText().length()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        UUID bookmarkId=UUID.randomUUID(); Instant now=Instant.now();
        jdbc.update("INSERT INTO reader_bookmarks(id,user_id,document_id,position_offset,label,excerpt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                bookmarkId,owner(auth),id,input.positionOffset(),clean(input.label()),input.excerpt().strip(),java.sql.Timestamp.from(now),java.sql.Timestamp.from(now));
        return new Bookmark(bookmarkId,input.positionOffset(),clean(input.label()),input.excerpt().strip(),now,now);
    }
    @PutMapping("/{id}/bookmarks/{bookmarkId}") Bookmark updateBookmark(Authentication auth,@PathVariable UUID id,
                                                                          @PathVariable UUID bookmarkId,
                                                                          @Valid @RequestBody BookmarkUpdate input) {
        owned(id,auth);String label=clean(input.label());
        if(jdbc.update("UPDATE reader_bookmarks SET label=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND document_id=? AND user_id=?",
                label,bookmarkId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return jdbc.query("SELECT id,position_offset,label,excerpt,created_at,updated_at FROM reader_bookmarks WHERE id=?",
                rs->{if(!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);return new Bookmark(rs.getObject(1,UUID.class),rs.getInt(2),rs.getString(3),rs.getString(4),rs.getTimestamp(5).toInstant(),rs.getTimestamp(6).toInstant());},bookmarkId);
    }
    @DeleteMapping("/{id}/bookmarks/{bookmarkId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeBookmark(Authentication auth,@PathVariable UUID id,@PathVariable UUID bookmarkId) {
        owned(id,auth); if(jdbc.update("DELETE FROM reader_bookmarks WHERE id=? AND document_id=? AND user_id=?",bookmarkId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping("/{id}/highlights") List<Highlight> highlights(Authentication auth,@PathVariable UUID id) {
        owned(id,auth);
        return jdbc.query("SELECT id,start_offset,end_offset,color,exact_text,note,created_at,updated_at FROM reader_highlights WHERE user_id=? AND document_id=? ORDER BY start_offset",
                (rs,n)->new Highlight(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4),rs.getString(5),rs.getString(6),rs.getTimestamp(7).toInstant(),rs.getTimestamp(8).toInstant()),owner(auth),id);
    }
    @PostMapping("/{id}/highlights") @ResponseStatus(HttpStatus.CREATED) Highlight addHighlight(Authentication auth,@PathVariable UUID id,@Valid @RequestBody HighlightInput input) {
        Document doc=owned(id,auth);
        if(input.endOffset()<=input.startOffset() || input.endOffset()-input.startOffset()>10000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Некорректный диапазон выделения");
        int start=input.startOffset(),end=input.endOffset();
        if(start<0 || end>doc.getOriginalText().length()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Некорректный диапазон выделения");
        String actual=doc.getOriginalText().substring(start,end);
        if(input.exactText()!=null && !actual.equals(input.exactText())) {
            int[] matched=Set.of("pdf","docx").contains(doc.getSourceType())
                    ?findNormalizedSelection(doc.getOriginalText(),input.exactText(),start):null;
            if(matched==null) throw new ResponseStatusException(HttpStatus.CONFLICT,"Текст книги изменился");
            start=matched[0];end=matched[1];actual=doc.getOriginalText().substring(start,end);
        }
        UUID userId=owner(auth);
        Integer duplicates=jdbc.queryForObject("SELECT count(*) FROM reader_highlights WHERE user_id=? AND document_id=? AND start_offset=? AND end_offset=?",
                Integer.class,userId,id,start,end);
        if(duplicates!=null && duplicates>0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Этот фрагмент уже выделен");
        UUID highlightId=UUID.randomUUID(); Instant now=Instant.now(); String color=input.color()==null?"yellow":input.color();
        jdbc.update("INSERT INTO reader_highlights(id,user_id,document_id,start_offset,end_offset,color,exact_text,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                highlightId,userId,id,start,end,color,actual,clean(input.note()),java.sql.Timestamp.from(now),java.sql.Timestamp.from(now));
        return new Highlight(highlightId,start,end,color,actual,clean(input.note()),now,now);
    }
    @PutMapping("/{id}/highlights/{highlightId}") Highlight updateHighlight(Authentication auth,@PathVariable UUID id,
                                                                              @PathVariable UUID highlightId,
                                                                              @Valid @RequestBody HighlightUpdate input) {
        owned(id,auth);String note=clean(input.note());
        if(jdbc.update("UPDATE reader_highlights SET color=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND document_id=? AND user_id=?",
                input.color(),note,highlightId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return jdbc.query("SELECT id,start_offset,end_offset,color,exact_text,note,created_at,updated_at FROM reader_highlights WHERE id=?",
                rs->{if(!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);return new Highlight(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4),rs.getString(5),rs.getString(6),rs.getTimestamp(7).toInstant(),rs.getTimestamp(8).toInstant());},highlightId);
    }
    @DeleteMapping("/{id}/highlights/{highlightId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeHighlight(Authentication auth,@PathVariable UUID id,@PathVariable UUID highlightId) {
        owned(id,auth); if(jdbc.update("DELETE FROM reader_highlights WHERE id=? AND document_id=? AND user_id=?",highlightId,id,owner(auth))==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    @GetMapping(value="/{id}/annotations/export",produces="text/markdown;charset=UTF-8") ResponseEntity<byte[]> exportAnnotations(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth);UUID user=owner(auth);
        var bookmarkRows=jdbc.query("SELECT position_offset,label,excerpt,created_at,updated_at FROM reader_bookmarks WHERE user_id=? AND document_id=? ORDER BY position_offset",
                (rs,n)->new BookmarkExport(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getTimestamp(4).toInstant(),rs.getTimestamp(5).toInstant()),user,id);
        var highlightRows=jdbc.query("SELECT start_offset,color,exact_text,note,created_at,updated_at FROM reader_highlights WHERE user_id=? AND document_id=? ORDER BY start_offset",
                (rs,n)->new HighlightExport(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getString(4),rs.getTimestamp(5).toInstant(),rs.getTimestamp(6).toInstant()),user,id);
        StringBuilder markdown=new StringBuilder("# ").append(markdown(doc.getTitle())).append(" — заметки и цитаты\n\n");
        markdown.append("Экспортировано: ").append(DateTimeFormatter.ISO_INSTANT.format(Instant.now())).append("\n\n");
        markdown.append("## Закладки\n\n");
        if(bookmarkRows.isEmpty()) markdown.append("_Закладок нет._\n\n");
        for(var item:bookmarkRows) {
            markdown.append("### ").append(markdown(item.label()==null?"Закладка":item.label())).append("\n\n")
                    .append("> ").append(markdown(item.excerpt())).append("\n\n")
                    .append("Позиция: ").append(item.positionOffset()).append(" · Создано: ").append(DateTimeFormatter.ISO_INSTANT.format(item.createdAt()));
            if(!item.updatedAt().equals(item.createdAt())) markdown.append(" · Изменено: ").append(DateTimeFormatter.ISO_INSTANT.format(item.updatedAt()));
            markdown.append("\n\n");
        }
        markdown.append("## Выделения и заметки\n\n");
        if(highlightRows.isEmpty()) markdown.append("_Выделений нет._\n");
        for(var item:highlightRows) {
            markdown.append("### Позиция ").append(item.positionOffset()).append(" · ").append(colorLabel(item.color())).append("\n\n")
                    .append("> ").append(markdown(item.exactText()).replace("\n","\n> ")).append("\n\n");
            if(item.note()!=null) markdown.append(markdown(item.note())).append("\n\n");
            markdown.append("Создано: ").append(DateTimeFormatter.ISO_INSTANT.format(item.createdAt()));
            if(!item.updatedAt().equals(item.createdAt())) markdown.append(" · Изменено: ").append(DateTimeFormatter.ISO_INSTANT.format(item.updatedAt()));
            markdown.append("\n\n");
        }
        String safeName=doc.getTitle().replaceAll("[\\\\/:*?\"<>|]","_").strip();
        if(safeName.isBlank()) safeName="book";
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/markdown;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(safeName+"-notes.md",StandardCharsets.UTF_8).build().toString())
                .body(markdown.toString().getBytes(StandardCharsets.UTF_8));
    }

    record BookmarkExport(int positionOffset,String label,String excerpt,Instant createdAt,Instant updatedAt) {}
    record HighlightExport(int positionOffset,String color,String exactText,String note,Instant createdAt,Instant updatedAt) {}

    private String markdown(String value) { return value.replace("\\","\\\\").replace("`","\\`").replace("*","\\*").replace("_","\\_"); }
    private String colorLabel(String color) { return switch(color) {case "green"->"зелёный";case "blue"->"синий";case "pink"->"розовый";default->"жёлтый";}; }

    @GetMapping("/{id}/preview") ResponseEntity<byte[]> preview(Authentication auth,@PathVariable UUID id) {
        Document doc=owned(id,auth);
        if(!"docx".equals(doc.getSourceType()))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,"Предпросмотр PDF создаётся только для DOCX");
        var rows=jdbc.query("SELECT rendered_file,original_file FROM documents WHERE id=?",
                (rs,n)->new RenderedPreview(rs.getBytes(1),rs.getBytes(2)),id);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        byte[] data=rows.getFirst().rendered();
        if(data==null || data.length==0) {
            byte[] original=rows.getFirst().original();
            if(original==null || original.length==0)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"Исходный DOCX недоступен");
            data=previews.docxToPdf(original).orElseThrow(()->new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Для точного просмотра DOCX требуется LibreOffice; используется совместимый просмотрщик"));
            jdbc.update("UPDATE documents SET rendered_file=?,rendered_media_type='application/pdf',rendered_at=CURRENT_TIMESTAMP WHERE id=?",data,id);
        }
        String filename=doc.getTitle().replaceAll("[\\\\/:*?\"<>|]","_")+".pdf";
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.inline().filename(filename,StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL,"private, max-age=86400").body(data);
    }

    @GetMapping("/{id}/original") ResponseEntity<byte[]> original(Authentication auth,@PathVariable UUID id,
                                                                    @RequestParam(defaultValue="false") boolean download) {
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
                (download?ContentDisposition.attachment():ContentDisposition.inline()).filename(filename,StandardCharsets.UTF_8).build().toString()).body(data);
    }

    private String clean(String value) { return value==null || value.isBlank()?null:value.strip(); }
    private Object[] concat(Object[] values,Object... tail) {var result=Arrays.copyOf(values,values.length+tail.length);System.arraycopy(tail,0,result,values.length,tail.length);return result;}
    private record BinaryAsset(byte[] content,String mediaType) {}
    private record RenderedPreview(byte[] rendered,byte[] original) {}
    private record SearchSection(int number,int startOffset,String content) {}
    private record Excerpt(String text,int start) {}
    private record NormalizedText(String text,List<Integer> starts,List<Integer> ends) {}
    private int[] findNormalizedSelection(String source,String selected,int approximateStart) {
        NormalizedText haystack=normalizeWithOffsets(source),needle=normalizeWithOffsets(selected);
        if(needle.text().isBlank()) return null;
        int match=-1,bestDistance=Integer.MAX_VALUE,from=0;
        while(from<=haystack.text().length()-needle.text().length()) {
            int candidate=haystack.text().indexOf(needle.text(),from);
            if(candidate<0) break;
            int originalStart=haystack.starts().get(candidate),distance=Math.abs(originalStart-approximateStart);
            if(distance<bestDistance) {match=candidate;bestDistance=distance;}
            from=candidate+1;
        }
        if(match<0) return null;
        int last=match+needle.text().length()-1;
        return new int[]{haystack.starts().get(match),haystack.ends().get(last)};
    }
    private NormalizedText normalizeWithOffsets(String value) {
        var text=new StringBuilder();var starts=new ArrayList<Integer>();var ends=new ArrayList<Integer>();
        boolean whitespace=false;int whitespaceStart=0;
        for(int index=0;index<value.length();index++) {
            char character=value.charAt(index);
            if(Character.isWhitespace(character)) {
                if(!whitespace) whitespaceStart=index;
                whitespace=true;continue;
            }
            if(whitespace && !text.isEmpty()) {text.append(' ');starts.add(whitespaceStart);ends.add(index);}
            whitespace=false;text.append(character);starts.add(index);ends.add(index+1);
        }
        return new NormalizedText(text.toString(),starts,ends);
    }
    private Excerpt excerpt(String content,int matchStart,int matchEnd) {
        int max=200,matchLength=matchEnd-matchStart,remaining=Math.max(0,max-matchLength);
        int start=Math.max(0,matchStart-remaining/2),end=Math.min(content.length(),matchEnd+(remaining-(matchStart-start)));
        if(end-start<max) start=Math.max(0,start-(max-(end-start)));
        if(start>0 && Character.isLowSurrogate(content.charAt(start))) start--;
        if(end<content.length() && end>0 && Character.isHighSurrogate(content.charAt(end-1))) end++;
        return new Excerpt(content.substring(start,end),start);
    }
    private List<String> genres(UUID id) { return jdbc.query("SELECT genre FROM book_genres WHERE document_id=? ORDER BY lower(genre)",(rs,n)->rs.getString(1),id); }
    private List<Asset> sectionAssets(UUID id,int number) {
        return jdbc.query("SELECT a.id,a.media_type FROM reader_section_assets r JOIN book_assets a ON a.id=r.asset_id WHERE r.document_id=? AND r.section_number=? ORDER BY r.order_index",
                (rs,n)->new Asset(rs.getObject(1,UUID.class),rs.getString(2)),id,number);
    }
    private List<SectionLink> sectionLinks(UUID id,int number) {
        return jdbc.query("SELECT start_offset,end_offset,target_section_number,target_section_offset,target_position_offset,kind FROM reader_section_links WHERE document_id=? AND section_number=? ORDER BY link_number",
                (rs,n)->new SectionLink(rs.getInt(1),rs.getInt(2),rs.getInt(3),rs.getInt(4),rs.getInt(5),rs.getString(6)),id,number);
    }
    private ResponseEntity<byte[]> image(BinaryAsset asset) {
        if(asset.mediaType()==null || !asset.mediaType().startsWith("image/")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        MediaType type;
        try { type=MediaType.parseMediaType(asset.mediaType()); } catch(IllegalArgumentException ignored) { type=MediaType.APPLICATION_OCTET_STREAM; }
        return ResponseEntity.ok().contentType(type).header(HttpHeaders.CACHE_CONTROL,"private, max-age=86400").body(asset.content());
    }
    private BookCollection collectionOwned(UUID id,UUID user) {
        return jdbc.query("SELECT c.id,c.name,count(d.id),c.created_at,c.updated_at FROM book_collections c "+
                        "LEFT JOIN documents d ON d.collection_id=c.id AND d.material_type='BOOK' WHERE c.id=? AND c.user_id=? GROUP BY c.id",
                rs->{if(!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Коллекция не найдена");return new BookCollection(
                        rs.getObject(1,UUID.class),rs.getString(2),rs.getLong(3),rs.getTimestamp(4).toInstant(),rs.getTimestamp(5).toInstant());},id,user);
    }
    private void ensureCollectionNameAvailable(UUID user,UUID excludedId,String name) {
        Boolean exists=excludedId==null
                ? jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM book_collections WHERE user_id=? AND lower(trim(name))=lower(trim(?)))",Boolean.class,user,name)
                : jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM book_collections WHERE user_id=? AND id<>? AND lower(trim(name))=lower(trim(?)))",Boolean.class,user,excludedId,name);
        if(Boolean.TRUE.equals(exists)) throw new ResponseStatusException(HttpStatus.CONFLICT,"Коллекция с таким названием уже существует");
    }
    private UUID owner(Authentication auth) { return UUID.fromString(auth.getName()); }
    private Document owned(UUID id,Authentication auth) {
        return documents.findByIdAndUserId(id,owner(auth)).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}

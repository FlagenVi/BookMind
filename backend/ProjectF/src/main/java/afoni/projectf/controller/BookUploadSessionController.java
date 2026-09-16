package afoni.projectf.controller;

import afoni.projectf.model.MaterialType;
import afoni.projectf.service.BookImportService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/book-uploads")
public class BookUploadSessionController {
    private static final int MAX_FILE=30*1024*1024;
    private static final int MAX_CHUNK=4*1024*1024;
    private final JdbcTemplate jdbc;
    private final BookImportService imports;

    public BookUploadSessionController(JdbcTemplate jdbc,BookImportService imports) {
        this.jdbc=jdbc;this.imports=imports;
    }

    record StartInput(@NotBlank @Size(max=255) String filename,@NotBlank @Size(max=200) String title,
                      @Min(1) @Max(MAX_FILE) int size,@Pattern(regexp="(?i)BOOK|DOCUMENT") String materialType) {}
    record ImportReport(int importedSections,int expectedSpineItems,int importedSpineItems,
                        int importedImages,int missingImages,int skippedTocEntries,List<String> metadataWarnings) {}
    record Session(UUID id,int confirmedOffset,int expectedSize,String status,UUID documentId,Instant expiresAt,
                   String materialType,int importProgress,String errorMessage,ImportReport report) {}
    record CompleteInput(@NotBlank @Pattern(regexp="[0-9a-fA-F]{64}") String sha256) {}

    @PostMapping @ResponseStatus(HttpStatus.CREATED) @Transactional
    Session start(Authentication auth,@Valid @RequestBody StartInput input) {
        String filename=safeFilename(input.filename());
        int dot=filename.lastIndexOf('.');
        if(dot<1) throw bad("Поддерживаются EPUB, FB2, TXT, MD, PDF и DOCX");
        String format=filename.substring(dot+1).toLowerCase(Locale.ROOT);
        if(!Set.of("txt","md","epub","fb2","pdf","docx").contains(format)) throw bad("Поддерживаются EPUB, FB2, TXT, MD, PDF и DOCX");
        MaterialType type=materialType(input.materialType(),format);
        UUID id=UUID.randomUUID(); Instant expires=Instant.now().plusSeconds(24*60*60);
        jdbc.update("INSERT INTO book_upload_sessions(id,user_id,original_filename,title,format,expected_size,expires_at,material_type) VALUES (?,?,?,?,?,?,?,?)",
                id,owner(auth),filename,input.title().strip(),format,input.size(),java.sql.Timestamp.from(expires),type.name());
        return ownedSession(auth,id,false);
    }

    @GetMapping("/{id}") Session status(Authentication auth,@PathVariable UUID id) {
        return ownedSession(auth,id,false);
    }

    @PatchMapping(value="/{id}",consumes=MediaType.APPLICATION_OCTET_STREAM_VALUE) @Transactional
    Session append(Authentication auth,@PathVariable UUID id,@RequestHeader("Upload-Offset") int offset,@RequestBody byte[] chunk) {
        if(chunk.length==0 || chunk.length>MAX_CHUNK) throw bad("Размер блока должен быть от 1 байта до 4 МБ");
        Session current=ownedSession(auth,id,true);
        if(!"uploading".equals(current.status())) throw new ResponseStatusException(HttpStatus.CONFLICT,"Загрузка уже завершена");
        if(offset!=current.confirmedOffset()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Смещение не совпадает с сохранённым",null);
        if((long)offset+chunk.length>current.expectedSize()) throw bad("Блок выходит за границы файла");
        int updated=jdbc.update("UPDATE book_upload_sessions SET uploaded_bytes=uploaded_bytes || ?,confirmed_offset=confirmed_offset+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND confirmed_offset=? AND status='uploading'",
                chunk,chunk.length,id,owner(auth),offset);
        if(updated!=1) throw new ResponseStatusException(HttpStatus.CONFLICT,"Загрузка была изменена другим запросом");
        return ownedSession(auth,id,false);
    }

    @PostMapping("/{id}/complete") @ResponseStatus(HttpStatus.ACCEPTED) @Transactional
    Session complete(Authentication auth,@PathVariable UUID id,@Valid @RequestBody CompleteInput input) {
        Session current=ownedSession(auth,id,true);
        if(Set.of("queued","importing","completed").contains(current.status())) return current;
        if("failed".equals(current.status())) throw new ResponseStatusException(HttpStatus.CONFLICT,"Исправимую ошибку можно запустить повторно без загрузки файла");
        if(current.confirmedOffset()!=current.expectedSize()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Файл загружен не полностью");
        byte[] bytes=jdbc.queryForObject("SELECT uploaded_bytes FROM book_upload_sessions WHERE id=? AND user_id=?",byte[].class,id,owner(auth));
        String actual=sha256(bytes);
        if(!MessageDigest.isEqual(actual.getBytes(java.nio.charset.StandardCharsets.US_ASCII),input.sha256().toLowerCase(Locale.ROOT).getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
            throw bad("Контрольная сумма файла не совпала. Повторите загрузку");
        jdbc.update("UPDATE book_upload_sessions SET status='queued',expected_sha256=?,import_progress=0,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='uploading'",actual,id);
        return ownedSession(auth,id,false);
    }

    @PostMapping("/{id}/retry") @ResponseStatus(HttpStatus.ACCEPTED)
    Session retry(Authentication auth,@PathVariable UUID id) {
        imports.retry(id,owner(auth));
        return ownedSession(auth,id,false);
    }

    private Session ownedSession(Authentication auth,UUID id,boolean lock) {
        String suffix=lock?" FOR UPDATE":"";
        var rows=jdbc.query("""
                        SELECT id,confirmed_offset,expected_size,status,document_id,expires_at,material_type,
                               import_progress,error_message,imported_sections,expected_spine_items,
                               imported_spine_items,imported_images,missing_images,skipped_toc_entries,metadata_warnings
                        FROM book_upload_sessions WHERE id=? AND user_id=?
                        """+suffix,
                (rs,n)->new Session(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4),
                        rs.getObject(5,UUID.class),rs.getTimestamp(6).toInstant(),rs.getString(7),rs.getInt(8),
                        rs.getString(9),new ImportReport(rs.getInt(10),rs.getInt(11),rs.getInt(12),rs.getInt(13),
                        rs.getInt(14),rs.getInt(15),splitWarnings(rs.getString(16)))),id,owner(auth));
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Session value=rows.getFirst();
        if("uploading".equals(value.status()) && value.expiresAt().isBefore(Instant.now())) throw new ResponseStatusException(HttpStatus.GONE,"Срок загрузки истёк");
        return value;
    }
    private List<String> splitWarnings(String value) { return value==null || value.isBlank()?List.of():Arrays.stream(value.split("; ")).toList(); }
    private String safeFilename(String value) {
        String filename=value.replace('\\','/'); filename=filename.substring(filename.lastIndexOf('/')+1).strip();
        if(filename.isBlank() || filename.length()>255) throw bad("Некорректное имя файла");
        return filename;
    }
    private String sha256(byte[] bytes) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
        catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
    private UUID owner(Authentication auth){return UUID.fromString(auth.getName());}
    private ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
    private MaterialType materialType(String value,String format) {
        try { return MaterialType.requestedOrDefault(value,format); }
        catch(IllegalArgumentException error) { throw bad(error.getMessage()); }
    }
}

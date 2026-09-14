package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.service.BookTextExtractor;
import afoni.projectf.service.DocumentPreparation;
import afoni.projectf.service.ReaderStructureService;
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
    private final DocumentRepository documents;
    private final BookTextExtractor extractor;
    private final DocumentPreparation preparation;
    private final ReaderStructureService structures;

    public BookUploadSessionController(JdbcTemplate jdbc,DocumentRepository documents,
                                       BookTextExtractor extractor,DocumentPreparation preparation,ReaderStructureService structures) {
        this.jdbc=jdbc;this.documents=documents;this.extractor=extractor;this.preparation=preparation;this.structures=structures;
    }

    record StartInput(@NotBlank @Size(max=255) String filename,@NotBlank @Size(max=200) String title,
                      @Min(1) @Max(MAX_FILE) int size) {}
    record Session(UUID id,int confirmedOffset,int expectedSize,String status,UUID documentId,Instant expiresAt) {}
    record CompleteInput(@NotBlank @Pattern(regexp="[0-9a-fA-F]{64}") String sha256) {}
    record Completed(UUID id,String title) {}

    @PostMapping @ResponseStatus(HttpStatus.CREATED) @Transactional
    Session start(Authentication auth,@Valid @RequestBody StartInput input) {
        String filename=safeFilename(input.filename());
        int dot=filename.lastIndexOf('.');
        if(dot<1) throw bad("Поддерживаются EPUB, FB2, TXT, PDF и DOCX");
        String format=filename.substring(dot+1).toLowerCase(Locale.ROOT);
        if(!Set.of("txt","epub","fb2","pdf","docx").contains(format)) throw bad("Поддерживаются EPUB, FB2, TXT, PDF и DOCX");
        UUID id=UUID.randomUUID(); Instant expires=Instant.now().plusSeconds(24*60*60);
        jdbc.update("INSERT INTO book_upload_sessions(id,user_id,original_filename,title,format,expected_size,expires_at) VALUES (?,?,?,?,?,?,?)",
                id,owner(auth),filename,input.title().strip(),format,input.size(),java.sql.Timestamp.from(expires));
        return new Session(id,0,input.size(),"uploading",null,expires);
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

    @PostMapping("/{id}/complete") @Transactional
    Completed complete(Authentication auth,@PathVariable UUID id,@Valid @RequestBody CompleteInput input) {
        Session current=ownedSession(auth,id,true);
        if("completed".equals(current.status()) && current.documentId()!=null) {
            Document existing=documents.findByIdAndUserId(current.documentId(),owner(auth)).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
            return new Completed(existing.getId(),existing.getTitle());
        }
        if(current.confirmedOffset()!=current.expectedSize()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Файл загружен не полностью");
        var rows=jdbc.query("SELECT original_filename,title,format,uploaded_bytes FROM book_upload_sessions WHERE id=? AND user_id=? FOR UPDATE",
                (rs,n)->new UploadData(rs.getString(1),rs.getString(2),rs.getString(3),rs.getBytes(4)),id,owner(auth));
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        UploadData data=rows.getFirst(); String actual=sha256(data.bytes());
        if(!MessageDigest.isEqual(actual.getBytes(java.nio.charset.StandardCharsets.US_ASCII),input.sha256().toLowerCase(Locale.ROOT).getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
            throw bad("Контрольная сумма файла не совпала. Повторите загрузку");
        var book=extractor.extractBook(data.bytes(),data.format());String text=book.text();
        String filenameTitle=data.filename().substring(0,data.filename().lastIndexOf('.'));
        String title=book.suggestedTitle()!=null && data.title().equals(filenameTitle)?book.suggestedTitle():data.title();
        if(title.length()>200) title=title.substring(0,200);
        var document=new Document(); document.setUserId(owner(auth));document.setTitle(title);
        document.setOriginalText(text);document.setSourceType(data.format());document.setOriginalFilename(data.filename());
        documents.saveAndFlush(document);
        jdbc.update("UPDATE documents SET original_file=?,original_sha256=?,original_size=? WHERE id=?",data.bytes(),actual,data.bytes().length,document.getId());
        structures.save(document.getId(),book);
        preparation.enqueue(document.getId(),text.length());
        jdbc.update("UPDATE book_upload_sessions SET uploaded_bytes=''::bytea,status='completed',document_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",document.getId(),id);
        return new Completed(document.getId(),document.getTitle());
    }

    private record UploadData(String filename,String title,String format,byte[] bytes) {}
    private Session ownedSession(Authentication auth,UUID id,boolean lock) {
        String suffix=lock?" FOR UPDATE":"";
        var rows=jdbc.query("SELECT id,confirmed_offset,expected_size,status,document_id,expires_at FROM book_upload_sessions WHERE id=? AND user_id=?"+suffix,
                (rs,n)->new Session(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3),rs.getString(4),rs.getObject(5,UUID.class),rs.getTimestamp(6).toInstant()),id,owner(auth));
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Session value=rows.getFirst();
        if("uploading".equals(value.status()) && value.expiresAt().isBefore(Instant.now())) throw new ResponseStatusException(HttpStatus.GONE,"Срок загрузки истёк");
        return value;
    }
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
}

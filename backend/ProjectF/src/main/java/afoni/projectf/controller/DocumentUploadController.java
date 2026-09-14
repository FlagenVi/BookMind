package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.service.DocumentPreparation;
import afoni.projectf.service.BookTextExtractor;
import afoni.projectf.service.ReaderStructureService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.util.Locale;
import java.util.UUID;
import java.util.Map;
import java.security.MessageDigest;
import java.util.HexFormat;

@RestController @RequestMapping("/api/documents")
public class DocumentUploadController {
    private final DocumentRepository documents;
    private final DocumentPreparation preparation;
    private final JdbcTemplate jdbc;
    private final BookTextExtractor extractor;
    private final ReaderStructureService structures;
    public DocumentUploadController(DocumentRepository documents, DocumentPreparation preparation, JdbcTemplate jdbc,
                                    BookTextExtractor extractor,ReaderStructureService structures) {
        this.documents=documents; this.preparation=preparation; this.jdbc=jdbc; this.extractor=extractor;this.structures=structures;
    }
    @PostMapping(value="/upload", consumes="multipart/form-data") @ResponseStatus(HttpStatus.ACCEPTED) @Transactional
    Map<String,Object> upload(Authentication auth, @RequestParam MultipartFile file,
                              @RequestParam(defaultValue="") String title) throws IOException {
        String filename = file.getOriginalFilename();
        if (filename == null) throw bad("Поддерживаются TXT, EPUB, FB2, PDF и DOCX");
        filename = filename.replace('\\','/'); filename = filename.substring(filename.lastIndexOf('/')+1);
        if (filename.lastIndexOf('.')<0) throw bad("Поддерживаются TXT, EPUB, FB2, PDF и DOCX");
        String format=filename.substring(filename.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        if (!java.util.Set.of("txt","epub","fb2","pdf","docx").contains(format)) throw bad("Поддерживаются TXT, EPUB, FB2, PDF и DOCX");
        if (filename.length()>255) throw bad("Слишком длинное имя файла");
        int maxBytes=30*1024*1024;
        if (file.getSize()>maxBytes) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Максимум — 30 МБ");
        byte[] bytes;
        try (var stream = file.getInputStream()) { bytes = stream.readNBytes(maxBytes+1); }
        if (bytes.length>maxBytes) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Максимум — 30 МБ");
        var book=extractor.extractBook(bytes,format);String text=book.text();
        title=title.strip(); if (title.isEmpty()) title=book.suggestedTitle()==null?filename.substring(0,filename.lastIndexOf('.')):book.suggestedTitle();
        if (title.isBlank() || title.length()>200) throw bad("Название должно содержать от 1 до 200 символов");
        var document=new Document(); document.setUserId(UUID.fromString(auth.getName()));
        document.setTitle(title); document.setOriginalText(text); document.setSourceType(format); document.setOriginalFilename(filename);
        documents.saveAndFlush(document);
        String hash=sha256(bytes);
        jdbc.update("UPDATE documents SET original_file=?,original_sha256=?,original_size=? WHERE id=?",
                bytes,hash,bytes.length,document.getId());
        structures.save(document.getId(),book);
        preparation.enqueue(document.getId(),text.length());
        return Map.of("id",document.getId(),"title",title);
    }
    @GetMapping("/{id}/preparation") Map<String,Object> status(Authentication auth, @PathVariable UUID id) {
        owned(auth,id);
        var jobs=jdbc.queryForList("SELECT status,next_offset AS \"processedCharacters\",total_characters AS \"totalCharacters\",processed_parts AS \"processedParts\",error_message AS \"errorMessage\" FROM document_jobs WHERE document_id=?",id);
        return jobs.isEmpty()?Map.of("status","not_started"):jobs.getFirst();
    }
    @PostMapping("/{id}/preparation") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void prepare(Authentication auth,@PathVariable UUID id) {
        var doc=owned(auth,id); preparation.enqueue(id,doc.getOriginalText().length());
        jdbc.update("UPDATE document_jobs SET status='queued',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND status='failed'",id);
    }
    private Document owned(Authentication auth,UUID id) { return documents.findByIdAndUserId(id,UUID.fromString(auth.getName())).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND)); }
    private String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
}

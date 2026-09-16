package afoni.projectf.service;

import afoni.projectf.model.Document;
import afoni.projectf.model.MaterialType;
import afoni.projectf.repository.DocumentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class BookImportService {
    private final JdbcTemplate jdbc;
    private final DocumentRepository documents;
    private final BookTextExtractor extractor;
    private final DocumentPreparation preparation;
    private final ReaderStructureService structures;
    private final OfficePreviewService previews;
    private final TransactionTemplate transaction;

    public BookImportService(JdbcTemplate jdbc, DocumentRepository documents, BookTextExtractor extractor,
                             DocumentPreparation preparation, ReaderStructureService structures,
                             OfficePreviewService previews,
                             PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.documents = documents;
        this.extractor = extractor;
        this.preparation = preparation;
        this.structures = structures;
        this.previews = previews;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    public void processNext() {
        ImportJob job = transaction.execute(status -> {
            var jobs = jdbc.query("""
                    SELECT id,user_id,original_filename,title,format,uploaded_bytes,material_type
                    FROM book_upload_sessions
                    WHERE status='queued'
                       OR (status='importing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
                    ORDER BY updated_at,id
                    LIMIT 1 FOR UPDATE SKIP LOCKED
                    """, (rs, row) -> new ImportJob(
                    rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                    rs.getString("original_filename"), rs.getString("title"), rs.getString("format"),
                    rs.getBytes("uploaded_bytes"), MaterialType.valueOf(rs.getString("material_type"))));
            if (jobs.isEmpty()) return null;
            ImportJob selected = jobs.getFirst();
            jdbc.update("""
                    UPDATE book_upload_sessions
                    SET status='importing',import_progress=10,error_message=NULL,
                        attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                    """, selected.id());
            return selected;
        });
        if (job == null) return;

        try {
            var book = extractor.extractBook(job.bytes(), job.format());
            byte[] preview="docx".equals(job.format())?previews.docxToPdf(job.bytes()).orElse(null):null;
            jdbc.update("UPDATE book_upload_sessions SET import_progress=70,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='importing'", job.id());
            transaction.executeWithoutResult(status -> complete(job, book, preview));
        } catch (RuntimeException error) {
            String message = error instanceof ResponseStatusException response && response.getReason() != null
                    ? response.getReason()
                    : "Не удалось импортировать файл. Повторите импорт или выберите другой файл.";
            if (message.length() > 500) message = message.substring(0, 500);
            jdbc.update("""
                    UPDATE book_upload_sessions
                    SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP
                    WHERE id=? AND status='importing'
                    """, message, job.id());
        }
    }

    private void complete(ImportJob job, BookTextExtractor.ExtractedBook book, byte[] preview) {
        UUID existing = jdbc.query("SELECT document_id FROM book_upload_sessions WHERE id=? FOR UPDATE",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, job.id());
        if (existing != null) {
            jdbc.update("UPDATE book_upload_sessions SET status='completed',import_progress=100,updated_at=CURRENT_TIMESTAMP WHERE id=?", job.id());
            return;
        }

        String filenameTitle = job.filename().substring(0, job.filename().lastIndexOf('.'));
        String title = book.suggestedTitle() != null && job.title().equals(filenameTitle)
                ? book.suggestedTitle() : job.title();
        if (title.length() > 200) title = title.substring(0, 200);

        var document = new Document();
        document.setUserId(job.userId());
        document.setTitle(title);
        document.setOriginalText(book.text());
        document.setSourceType(job.format());
        document.setMaterialType(job.materialType());
        document.setOriginalFilename(job.filename());
        documents.saveAndFlush(document);
        String hash = jdbc.queryForObject("SELECT expected_sha256 FROM book_upload_sessions WHERE id=?", String.class, job.id());
        jdbc.update("UPDATE documents SET original_file=?,original_sha256=?,original_size=? WHERE id=?",
                job.bytes(), hash, job.bytes().length, document.getId());
        if(preview!=null) jdbc.update("UPDATE documents SET rendered_file=?,rendered_media_type='application/pdf',rendered_at=CURRENT_TIMESTAMP WHERE id=?",
                preview,document.getId());
        structures.save(document.getId(), book);
        preparation.enqueue(document.getId(), book.text().length());

        var diagnostics = book.diagnostics();
        String warnings = String.join("; ", diagnostics.metadataWarnings());
        jdbc.update("""
                UPDATE book_upload_sessions
                SET uploaded_bytes=''::bytea,status='completed',document_id=?,import_progress=100,
                    imported_sections=?,expected_spine_items=?,imported_spine_items=?,imported_images=?,
                    missing_images=?,skipped_toc_entries=?,metadata_warnings=?,error_message=NULL,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND status='importing'
                """, document.getId(), book.sections().size(), diagnostics.expectedSpineItems(),
                diagnostics.importedSpineItems(), book.assets().size(), diagnostics.missingImages(),
                diagnostics.skippedTocEntries(), warnings.isBlank() ? null : warnings, job.id());
    }

    public void retry(UUID sessionId, UUID userId) {
        int updated = jdbc.update("""
                UPDATE book_upload_sessions
                SET status='queued',import_progress=0,error_message=NULL,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND user_id=? AND status='failed' AND expected_sha256 IS NOT NULL
                """, sessionId, userId);
        if (updated != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "Этот импорт нельзя повторить");
    }

    private record ImportJob(UUID id, UUID userId, String filename, String title, String format,
                             byte[] bytes, MaterialType materialType) {}
}

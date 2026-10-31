package afoni.projectf.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.UUID;
import java.util.regex.Pattern;

/** Each part and its checkpoint commit together. A crashed worker needs no lease reset. */
@Service
public class DocumentPreparation {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private static final Pattern HEADING = Pattern.compile("(?imU)^[ \\t]*(?:глава|часть|раздел|chapter|part|section)\\b[^\\r\\n]{0,260}");
    public DocumentPreparation(JdbcTemplate jdbc, PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.transaction = new TransactionTemplate(manager);
    }
    public void enqueue(UUID id, int length) {
        jdbc.update("INSERT INTO document_jobs(document_id,total_characters) VALUES (?,?) ON CONFLICT DO NOTHING", id, length);
    }
    public void processNext() {
        UUID[] selected = new UUID[1];
        int[] checkpoint = new int[1];
        try {
            transaction.executeWithoutResult(tx -> {
                var jobs = jdbc.queryForList("SELECT document_id,next_offset,processed_parts FROM document_jobs WHERE status IN ('queued','processing') ORDER BY updated_at,document_id LIMIT 1 FOR UPDATE SKIP LOCKED");
                if (jobs.isEmpty()) return;
                var job = jobs.getFirst();
                UUID id = (UUID) job.get("document_id"); selected[0] = id;
                int start = ((Number) job.get("next_offset")).intValue(); checkpoint[0] = start;
                int number = ((Number) job.get("processed_parts")).intValue();
                String text = jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?", String.class, id);
                if (text == null || start >= text.length()) throw new IllegalStateException("Invalid checkpoint");
                int end = Math.min(start + 6000, text.length());
                var headings = HEADING.matcher(text).useAnchoringBounds(false);
                headings.region(start, end);
                String heading = number == 0 ? "Начало документа" : jdbc.queryForObject("SELECT heading FROM document_parts WHERE document_id=? AND part_number=?", String.class, id, number - 1);
                if (headings.find()) {
                    if (headings.start() == start) {
                        heading = headings.group().strip();
                        if (headings.find()) end = headings.start();
                    } else end = headings.start();
                }
                if (end == Math.min(start + 6000, text.length()) && end < text.length()) {
                    int boundary = text.lastIndexOf('\n', end - 1);
                    if (boundary < start + 3000) boundary = text.lastIndexOf(' ', end - 1);
                    if (boundary >= start + 3000) end = boundary + 1;
                }
                if (end < text.length() && Character.isLowSurrogate(text.charAt(end)) && Character.isHighSurrogate(text.charAt(end-1))) end--;
                jdbc.update("INSERT INTO document_parts(document_id,part_number,heading,start_offset,end_offset,content) VALUES (?,?,?,?,?,?)", id, number, heading, start, end, text.substring(start,end));
                jdbc.update("UPDATE document_jobs SET next_offset=?,processed_parts=?,status=?,updated_at=CURRENT_TIMESTAMP,error_message=NULL WHERE document_id=?", end, number+1, end == text.length() ? "ready" : "processing", id);
            });
        } catch (RuntimeException exception) {
            // Do not persist exception text, document contents or connection details.
            if (selected[0] != null) jdbc.update("UPDATE document_jobs SET status='failed',error_message='Не удалось подготовить документ. Повторите обработку.',updated_at=CURRENT_TIMESTAMP WHERE document_id=? AND next_offset=? AND status IN ('queued','processing')", selected[0], checkpoint[0]);
        }
    }
}

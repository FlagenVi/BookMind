package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.repository.DocumentRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController @RequestMapping("/api/documents")
public class DocumentController {
    private final DocumentRepository documents;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    public DocumentController(DocumentRepository documents,org.springframework.jdbc.core.JdbcTemplate jdbc) { this.documents = documents; this.jdbc=jdbc; }

    public record Input(@NotBlank @Size(max=200) String title,
                        @NotBlank @Size(max=100000) String content) {
        public Input { if (title != null) title = title.trim(); if (content != null) content = content.trim(); }
    }
    public record Details(UUID id, String title, String content, Instant createdAt, Instant updatedAt) {
        static Details from(Document d) { return new Details(d.getId(), d.getTitle(), d.getOriginalText(), d.getCreatedAt(), d.getUpdatedAt()); }
    }
    public record Preview(UUID id, String title, String preview, Instant createdAt, java.util.Map<String,Object> processing) {}
    public record DocumentPage(List<Preview> items, int page, int totalPages, long totalElements) {}

    @GetMapping DocumentPage list(Authentication auth, @RequestParam(defaultValue="0") int page) {
        if (page < 0 || page > 100000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var result = documents.findPreviewsByUserId(owner(auth), PageRequest.of(page, 20, Sort.by(Sort.Direction.DESC, "createdAt", "id")));
        var states=new java.util.HashMap<UUID,java.util.Map<String,Object>>();
        if(!result.isEmpty()) {
            String placeholders=String.join(",",java.util.Collections.nCopies(result.getNumberOfElements(),"?"));
            var rows=jdbc.queryForList("SELECT d.id,p.status AS preparation,p.next_offset AS processed,p.total_characters AS total,j.status,j.compression_level AS level,j.round_number AS round,(SELECT count(*) FROM summary_steps s WHERE s.job_id=j.id AND s.round_number=j.round_number) AS steps,(SELECT count(*) FROM summary_steps s WHERE s.job_id=j.id AND s.round_number=j.round_number AND s.output_text IS NOT NULL) AS done FROM documents d LEFT JOIN document_jobs p ON p.document_id=d.id LEFT JOIN LATERAL (SELECT * FROM summary_jobs q WHERE q.document_id=d.id ORDER BY CASE WHEN q.status IN ('queued','running','waiting') THEN 0 ELSE 1 END,q.updated_at DESC LIMIT 1) j ON true WHERE d.id IN ("+placeholders+")",result.stream().map(d->d.getId()).toArray());
            for(var row:rows) states.put((UUID)row.get("id"),row);
        }
        return new DocumentPage(result.stream().map(d -> new Preview(d.getId(), d.getTitle(),
                d.getPreview(), d.getCreatedAt(),states.get(d.getId()))).toList(),
                page, result.getTotalPages(), result.getTotalElements());
    }

    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Details create(Authentication auth, @Valid @RequestBody Input input) {
        var document = new Document();
        document.setUserId(owner(auth)); document.setTitle(input.title()); document.setOriginalText(input.content());
        return Details.from(documents.saveAndFlush(document));
    }

    @GetMapping("/{id}") Details get(Authentication auth, @PathVariable UUID id) { return Details.from(owned(id, auth)); }

    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void delete(Authentication auth, @PathVariable UUID id) { documents.delete(owned(id, auth)); }

    private UUID owner(Authentication auth) { return UUID.fromString(auth.getName()); }
    private Document owned(UUID id, Authentication auth) {
        return documents.findByIdAndUserId(id, owner(auth)).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}

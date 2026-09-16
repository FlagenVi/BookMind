package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.model.MaterialType;
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
import java.util.Locale;
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
    public record Section(int number,String title,String role,int startOffset,int endOffset) {}
    public record Details(UUID id,String title,String content,String materialType,String sourceType,String originalFilename,
                          Instant createdAt,Instant updatedAt,List<Section> sections) {}
    public record Preview(UUID id,String title,String preview,String sourceType,String originalFilename,
                          Instant createdAt,Instant updatedAt,Long fileSizeBytes,Integer pageCount,
                          java.util.Map<String,Object> processing) {}
    public record DocumentPage(List<Preview> items, int page, int totalPages, long totalElements) {}

    @GetMapping DocumentPage list(Authentication auth, @RequestParam(defaultValue="0") int page,
                                  @RequestParam(defaultValue="") String q,
                                  @RequestParam(defaultValue="all") String format,
                                  @RequestParam(defaultValue="updated") String sort,
                                  @RequestParam(defaultValue="desc") String direction) {
        if (page < 0 || page > 100000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if (q.length() > 100 || !List.of("all", "pdf", "docx", "txt", "md", "manual").contains(format)
                || !List.of("updated", "created", "title", "size").contains(sort)
                || !List.of("asc", "desc").contains(direction))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String orderField = switch (sort) {
            case "created" -> "createdAt";
            case "title" -> "title";
            case "size" -> "originalSize";
            default -> "updatedAt";
        };
        var order = Sort.by(Sort.Direction.fromString(direction), orderField).and(Sort.by("id"));
        var result = documents.findPreviewsByUserIdAndMaterialType(owner(auth),MaterialType.DOCUMENT,
                q.trim().toLowerCase(Locale.ROOT),format,PageRequest.of(page, 20, order));
        var states=new java.util.HashMap<UUID,java.util.Map<String,Object>>();
        var fileSizes=new java.util.HashMap<UUID,Long>();
        var pageCounts=new java.util.HashMap<UUID,Integer>();
        if(!result.isEmpty()) {
            String placeholders=String.join(",",java.util.Collections.nCopies(result.getNumberOfElements(),"?"));
            var rows=jdbc.queryForList("SELECT d.id,d.original_size,CASE WHEN d.source_type='pdf' THEN (SELECT count(*) FROM reader_sections s WHERE s.document_id=d.id) ELSE NULL END AS page_count,p.status AS preparation,p.next_offset AS processed,p.total_characters AS total,j.status,j.compression_level AS level,j.round_number AS round,(SELECT count(*) FROM summary_steps s WHERE s.job_id=j.id AND s.round_number=j.round_number) AS steps,(SELECT count(*) FROM summary_steps s WHERE s.job_id=j.id AND s.round_number=j.round_number AND s.output_text IS NOT NULL) AS done FROM documents d LEFT JOIN document_jobs p ON p.document_id=d.id LEFT JOIN LATERAL (SELECT * FROM summary_jobs q WHERE q.document_id=d.id ORDER BY CASE WHEN q.status IN ('queued','running','waiting') THEN 0 ELSE 1 END,q.updated_at DESC LIMIT 1) j ON true WHERE d.id IN ("+placeholders+")",result.stream().map(d->d.getId()).toArray());
            for(var row:rows) {
                UUID id=(UUID)row.get("id");
                if(row.get("original_size") instanceof Number size) fileSizes.put(id,size.longValue());
                if(row.get("page_count") instanceof Number count && count.intValue()>0) pageCounts.put(id,count.intValue());
                var processing=new java.util.HashMap<>(row);
                processing.remove("id");processing.remove("original_size");processing.remove("page_count");
                states.put(id,processing);
            }
        }
        return new DocumentPage(result.stream().map(d -> new Preview(d.getId(),d.getTitle(),d.getPreview(),d.getSourceType(),
                d.getOriginalFilename(),d.getCreatedAt(),d.getUpdatedAt(),fileSizes.get(d.getId()),pageCounts.get(d.getId()),
                states.get(d.getId()))).toList(),
                page, result.getTotalPages(), result.getTotalElements());
    }

    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Details create(Authentication auth, @Valid @RequestBody Input input) {
        var document = new Document();
        document.setUserId(owner(auth)); document.setTitle(input.title()); document.setOriginalText(input.content());
        return details(documents.saveAndFlush(document));
    }

    @GetMapping("/{id}") Details get(Authentication auth, @PathVariable UUID id) { return details(owned(id, auth)); }

    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void delete(Authentication auth, @PathVariable UUID id) { documents.delete(owned(id, auth)); }

    private UUID owner(Authentication auth) { return UUID.fromString(auth.getName()); }
    private Document owned(UUID id, Authentication auth) {
        return documents.findByIdAndUserId(id, owner(auth)).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    private Details details(Document document) {
        var sections=jdbc.query("SELECT section_number,title,role,start_offset,end_offset FROM reader_sections WHERE document_id=? ORDER BY section_number",
                (rs,n)->new Section(rs.getInt(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5)),document.getId());
        if(sections.isEmpty()) sections=List.of(new Section(-1,"Документ","main",0,document.getOriginalText().length()));
        return new Details(document.getId(),document.getTitle(),document.getOriginalText(),document.getMaterialType().name(),
                document.getSourceType(),document.getOriginalFilename(),document.getCreatedAt(),document.getUpdatedAt(),sections);
    }
}

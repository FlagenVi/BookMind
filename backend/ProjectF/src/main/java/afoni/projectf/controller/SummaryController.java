package afoni.projectf.controller;

import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.service.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController @RequestMapping("/api/documents/{id}/summary")
public class SummaryController {
    private final DocumentRepository documents;
    private final JdbcTemplate jdbc;
    private final SummaryQueue queue;
    private final LlmSettings settings;
    public SummaryController(DocumentRepository documents,JdbcTemplate jdbc,SummaryQueue queue,LlmSettings settings) {
        this.documents=documents;this.jdbc=jdbc;this.queue=queue;this.settings=settings;
    }
    public record Options(String level) {}
    @PostMapping @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void start(Authentication auth,@PathVariable UUID id,@RequestBody Options options) {
        owned(auth,id); String level=options.level();
        jdbc.queryForObject("SELECT id FROM documents WHERE id=? FOR UPDATE",UUID.class,id);
        if(level==null || !Set.of("short","medium","detailed").contains(level)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите уровень подробности");
        if(!jdbc.queryForList("SELECT id FROM summary_jobs WHERE document_id=? AND compression_level<>? AND status IN ('queued','running','waiting')",id,level).isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Документ уже обрабатывается. Дождитесь завершения текущего изложения.");
        if(!settings.configured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Настройте Groq на сервере");
        var ready=jdbc.queryForList("SELECT document_id FROM document_jobs WHERE document_id=? AND status='ready'",id);
        if(ready.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Сначала подготовьте документ");
        UUID job=UUID.randomUUID();
        int inserted=jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name) VALUES (?,?,?,?) ON CONFLICT(document_id,compression_level) DO NOTHING",job,id,level,settings.model());
        if(inserted==1) queue.initialize(job,id);
        else jdbc.update("UPDATE summary_jobs SET status='queued',attempts=0,error_message=NULL,next_attempt_at=CURRENT_TIMESTAMP WHERE document_id=? AND compression_level=? AND status='failed'",id,level);
    }
    @GetMapping Map<String,Object> get(Authentication auth,@PathVariable UUID id,@RequestParam(defaultValue="medium") String level) {
        owned(auth,id);
        var jobs=jdbc.queryForList("SELECT j.id,j.status,j.round_number AS \"round\",j.tokens_used AS \"tokensUsed\",j.error_message AS \"errorMessage\",j.next_attempt_at AS \"nextAttemptAt\",s.summary_text AS \"text\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=j.id AND p.round_number=j.round_number) AS \"totalSteps\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=j.id AND p.round_number=j.round_number AND p.output_text IS NOT NULL) AS \"doneSteps\" FROM summary_jobs j LEFT JOIN summaries s ON s.id=j.result_id WHERE j.document_id=? AND j.compression_level=?",id,level);
        Map<String,Object> result=jobs.isEmpty()?new HashMap<>(Map.of("status","not_started")):new HashMap<>(jobs.getFirst());
        result.put("configured",settings.configured());
        var activeJobs=jdbc.queryForList("SELECT compression_level AS level,status FROM summary_jobs WHERE document_id=? AND status IN ('queued','running','waiting') ORDER BY created_at LIMIT 1",id);
        if(!activeJobs.isEmpty()) result.put("activeJob",activeJobs.getFirst());
        if(!jobs.isEmpty()) {
            Object job=jobs.getFirst().get("id");
            result.put("sections",jdbc.queryForList("SELECT section_number AS \"number\",heading,category,summary_text AS \"text\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=s.job_id AND p.section_number=s.section_number AND p.round_number=0) AS \"totalParts\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=s.job_id AND p.section_number=s.section_number AND p.round_number=0 AND p.output_text IS NOT NULL) AS \"doneParts\" FROM summary_sections s WHERE job_id=? ORDER BY section_number",job));
        }
        return result;
    }
    @GetMapping("/sections/{number}") List<Map<String,Object>> section(Authentication auth,@PathVariable UUID id,@PathVariable int number,@RequestParam(defaultValue="medium") String level,@RequestParam(defaultValue="0") int offset) {
        owned(auth,id);
        if(offset<0 || number<0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return jdbc.queryForList("SELECT s.step_number AS \"number\",s.output_text AS \"text\" FROM summary_steps s JOIN summary_jobs j ON j.id=s.job_id WHERE j.document_id=? AND j.compression_level=? AND s.section_number=? AND s.round_number=0 ORDER BY s.step_number LIMIT 20 OFFSET ?",id,level,number,offset);
    }
    private void owned(Authentication auth,UUID id) { if(!documents.existsById(id) || documents.findByIdAndUserId(id,UUID.fromString(auth.getName())).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND); }
}

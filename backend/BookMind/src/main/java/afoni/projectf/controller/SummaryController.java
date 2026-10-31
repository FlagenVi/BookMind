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
    public record Options(String level,String scope,Integer sectionNumber) {}
    @PostMapping @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void start(Authentication auth,@PathVariable UUID id,@RequestBody Options options) {
        owned(auth,id); String level=options.level();
        String scope=options.scope()==null?"whole":options.scope();
        int sectionNumber=options.sectionNumber()==null?-1:options.sectionNumber();
        jdbc.queryForObject("SELECT id FROM documents WHERE id=? FOR UPDATE",UUID.class,id);
        int revision=jdbc.queryForObject("SELECT novel_revision FROM documents WHERE id=?",Integer.class,id);
        if(level==null || !Set.of("short","medium","detailed").contains(level)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите уровень подробности");
        if(!Set.of("whole","chapter","through_chapter","read").contains(scope) || (Set.of("whole","read").contains(scope)?sectionNumber!=-1:sectionNumber<0))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите корректный объём текста");
        if(scope.equals("read")) {
            // The boundary always comes from the server-side reading progress, never from the client.
            sectionNumber=readBoundary(auth,id);
            if(sectionNumber<=0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Сначала начните читать: позиция чтения ещё не сохранена");
        } else if(!scope.equals("whole")) {
            var selected=jdbc.queryForList("SELECT role FROM reader_sections WHERE document_id=? AND section_number=?",id,sectionNumber);
            if(selected.isEmpty() || !"main".equals(selected.getFirst().get("role")))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выбранная глава не найдена");
        }
        if(!jdbc.queryForList("SELECT id FROM summary_jobs WHERE document_id=? AND status IN ('queued','running','waiting') AND NOT (compression_level=? AND scope_mode=? AND scope_section_number=?)",id,level,scope,sectionNumber).isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT,"Документ уже обрабатывается. Дождитесь завершения текущего изложения.");
        if(!settings.configured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Настройте DeepSeek на сервере");
        UUID job=UUID.randomUUID();
        int inserted=jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name,scope_mode,scope_section_number,source_revision) VALUES (?,?,?,?,?,?,?) ON CONFLICT(document_id,compression_level,scope_mode,scope_section_number) DO NOTHING",job,id,level,settings.model(),scope,sectionNumber,revision);
        if(inserted==1) queue.initialize(job,id,scope,sectionNumber);
        else {
            var existing=jdbc.queryForMap("SELECT id,status,pipeline_version,error_message,source_revision FROM summary_jobs WHERE document_id=? AND compression_level=? AND scope_mode=? AND scope_section_number=?",id,level,scope,sectionNumber);
            if(((Number)existing.get("source_revision")).intValue()!=revision) {
                UUID existingId=(UUID)existing.get("id");
                jdbc.update("DELETE FROM summary_steps WHERE job_id=?",existingId);
                jdbc.update("DELETE FROM summary_sections WHERE job_id=?",existingId);
                jdbc.update("UPDATE summary_jobs SET status='queued',round_number=0,attempts=0,error_message=NULL,result_id=NULL,model_name=?,source_revision=?,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",settings.model(),revision,existingId);
                queue.initialize(existingId,id,scope,sectionNumber);
            } else if("failed".equals(existing.get("status"))) {
                UUID existingId=(UUID)existing.get("id");
                if(((Number)existing.get("pipeline_version")).intValue()<4) {
                    jdbc.update("DELETE FROM summary_steps WHERE job_id=?",existingId);
                    jdbc.update("DELETE FROM summary_sections WHERE job_id=?",existingId);
                    jdbc.update("UPDATE summary_jobs SET status='queued',round_number=0,attempts=0,error_message=NULL,model_name=?,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",settings.model(),existingId);
                    queue.initialize(existingId,id,scope,sectionNumber);
                } else {
                    // A token-limited draft may omit the end of the source; never treat its compression as a complete book summary.
                    if(String.valueOf(existing.get("error_message")).startsWith("Модель исчерпала бюджет ответа"))
                        jdbc.update("UPDATE summary_steps SET repair_text=NULL WHERE job_id=? AND output_text IS NULL",existingId);
                    jdbc.update("UPDATE summary_jobs SET status='queued',attempts=0,error_message=NULL,model_name=?,next_attempt_at=CURRENT_TIMESTAMP WHERE id=?",settings.model(),existingId);
                }
            }
        }
    }
    @GetMapping Map<String,Object> get(Authentication auth,@PathVariable UUID id,@RequestParam(defaultValue="medium") String level,
                                      @RequestParam(defaultValue="whole") String scope,@RequestParam(defaultValue="-1") int sectionNumber) {
        owned(auth,id);
        if(scope.equals("read")) sectionNumber=readBoundary(auth,id);
        int revision=jdbc.queryForObject("SELECT novel_revision FROM documents WHERE id=?",Integer.class,id);
        var jobs=jdbc.queryForList("SELECT j.id,j.status,j.pipeline_version AS \"pipelineVersion\",j.round_number AS \"round\",j.tokens_used AS \"tokensUsed\",j.error_message AS \"errorMessage\",j.next_attempt_at AS \"nextAttemptAt\",s.summary_text AS \"text\",j.input_characters AS \"inputCharacters\",j.source_characters AS \"sourceCharacters\",(SELECT b.scope_section_number FROM summary_jobs b WHERE b.result_id=j.incremental_base_id LIMIT 1) AS \"baseBoundary\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=j.id AND p.round_number=j.round_number) AS \"totalSteps\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=j.id AND p.round_number=j.round_number AND p.output_text IS NOT NULL) AS \"doneSteps\" FROM summary_jobs j LEFT JOIN summaries s ON s.id=j.result_id WHERE j.document_id=? AND j.compression_level=? AND j.scope_mode=? AND j.scope_section_number=?",id,level,scope,sectionNumber);
        if(!jobs.isEmpty()) {
            int savedRevision=jdbc.queryForObject("SELECT source_revision FROM summary_jobs WHERE id=?",Integer.class,jobs.getFirst().get("id"));
            if(savedRevision!=revision) return new HashMap<>(Map.of("status","stale","configured",settings.configured()));
        }
        Map<String,Object> result=jobs.isEmpty()?new HashMap<>(Map.of("status","not_started")):new HashMap<>(jobs.getFirst());
        result.put("configured",settings.configured());
        if(scope.equals("read")) {
            result.put("readBoundary",sectionNumber);
            int length=jdbc.queryForObject("SELECT char_length(original_text) FROM documents WHERE id=?",Integer.class,id);
            result.put("readPercent",length==0?0:Math.min(100,(int)Math.round(sectionNumber*100.0/length)));
            if(result.get("baseBoundary") instanceof Number base)
                result.put("basePercent",length==0?0:Math.min(100,(int)Math.round(base.intValue()*100.0/length)));
        }
        var activeJobs=jdbc.queryForList("SELECT compression_level AS level,scope_mode AS scope,scope_section_number AS \"sectionNumber\",status FROM summary_jobs WHERE document_id=? AND status IN ('queued','running','waiting') ORDER BY created_at LIMIT 1",id);
        if(!activeJobs.isEmpty()) result.put("activeJob",activeJobs.getFirst());
        if(!jobs.isEmpty()) {
            Object job=jobs.getFirst().get("id");
            if("failed".equals(result.get("status"))) {
                var drafts=jdbc.queryForList("SELECT repair_text FROM summary_steps WHERE job_id=? AND round_number=? AND output_text IS NULL AND repair_text IS NOT NULL ORDER BY step_number LIMIT 1",job,result.get("round"));
                if(!drafts.isEmpty()) result.put("partialText",drafts.getFirst().get("repair_text"));
            }
            result.put("sections",jdbc.queryForList("SELECT section_number AS \"number\",heading,category,summary_text AS \"text\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=s.job_id AND p.section_number=s.section_number AND p.round_number=0) AS \"totalParts\",(SELECT count(*) FROM summary_steps p WHERE p.job_id=s.job_id AND p.section_number=s.section_number AND p.round_number=0 AND p.output_text IS NOT NULL) AS \"doneParts\" FROM summary_sections s WHERE job_id=? ORDER BY section_number",job));
        }
        return result;
    }
    @GetMapping("/sections/{number}") List<Map<String,Object>> section(Authentication auth,@PathVariable UUID id,@PathVariable int number,@RequestParam(defaultValue="medium") String level,@RequestParam(defaultValue="whole") String scope,@RequestParam(defaultValue="-1") int sectionNumber,@RequestParam(defaultValue="0") int offset) {
        owned(auth,id);
        if(scope.equals("read")) sectionNumber=readBoundary(auth,id);
        if(offset<0 || number<0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return jdbc.queryForList("SELECT s.step_number AS \"number\",s.output_text AS \"text\" FROM summary_steps s JOIN summary_jobs j ON j.id=s.job_id JOIN documents d ON d.id=j.document_id WHERE j.document_id=? AND j.compression_level=? AND j.scope_mode=? AND j.scope_section_number=? AND j.source_revision=d.novel_revision AND s.section_number=? AND s.round_number=0 ORDER BY s.step_number LIMIT 20 OFFSET ?",id,level,scope,sectionNumber,number,offset);
    }
    private int readBoundary(Authentication auth,UUID id) {
        if("novel".equals(jdbc.queryForObject("SELECT source_type FROM documents WHERE id=?",String.class,id)))
            return jdbc.queryForObject("SELECT COALESCE(sum(LEAST(s.end_offset-s.start_offset,n.confirmed_offset)),0) FROM reader_sections s JOIN novel_chapters n ON n.id=s.novel_chapter_id WHERE s.document_id=? AND s.role='main'",Integer.class,id);
        return jdbc.query("SELECT confirmed_offset FROM reading_progress WHERE user_id=? AND document_id=?",
                rs->rs.next()?rs.getInt(1):0,UUID.fromString(auth.getName()),id);
    }
    private void owned(Authentication auth,UUID id) { if(!documents.existsById(id) || documents.findByIdAndUserId(id,UUID.fromString(auth.getName())).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND); }
}

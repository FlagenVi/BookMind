package afoni.projectf.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

@Service
public class SummaryQueue {
    public static final int INPUT_BYTES=8000;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final Summarizer summarizer;
    private final LlmSettings settings;
    @org.springframework.beans.factory.annotation.Autowired
    public SummaryQueue(JdbcTemplate jdbc,PlatformTransactionManager manager,Summarizer summarizer,LlmSettings settings) {
        this.jdbc=jdbc; this.transaction=new TransactionTemplate(manager); this.summarizer=summarizer; this.settings=settings;
    }
    public SummaryQueue(JdbcTemplate jdbc,PlatformTransactionManager manager,Summarizer summarizer) {
        this(jdbc,manager,summarizer,null);
    }
    public static List<String> split(String text) {
        var result=new ArrayList<String>(); int start=0,bytes=0,index=0;
        while(index<text.length()) {
            int point=text.codePointAt(index); int length=new String(Character.toChars(point)).getBytes(StandardCharsets.UTF_8).length;
            if(bytes+length>INPUT_BYTES) {
                int boundary=text.lastIndexOf('\n',index-1);
                if(boundary<start+(index-start)/2) boundary=text.lastIndexOf(' ',index-1);
                if(boundary>=start+(index-start)/2) index=boundary+1;
                result.add(text.substring(start,index));start=index;bytes=0;continue;
            }
            bytes+=length; index+=Character.charCount(point);
        }
        if(start<text.length()) result.add(text.substring(start));
        return result;
    }
    public void initialize(UUID job,UUID document) {
        String text=jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?",String.class,document);
        var matcher=Pattern.compile("(?imU)^[ \\t]*(?:(?:глава|часть|раздел|chapter|part|section)\\b[^\\r\\n]{0,260}|(?:предисловие|введение|примечания|сноски|послесловие)[ \\t]*)$").matcher(text);
        var starts=new ArrayList<Integer>();var headings=new ArrayList<String>();
        while(matcher.find()) { starts.add(matcher.start());headings.add(matcher.group().strip()); }
        if(starts.isEmpty() || starts.getFirst()>0) { starts.addFirst(0);headings.addFirst("Начало документа"); }
        int number=0,section=0;
        String previousCategory="main";
        for(int i=0;i<starts.size();i++) {
            String content=text.substring(starts.get(i),i+1<starts.size()?starts.get(i+1):text.length());
            if(content.isBlank()) continue;
            String heading=headings.get(i);
            String category=heading.toLowerCase(Locale.ROOT).matches(".*(?:предисловие|введение|примечани|сноски|послесловие).*")?"ancillary":"main";
            if(heading.matches("(?iu)(?:Глава:\\s*)?\\d+\\s*")) category=previousCategory;
            previousCategory=category;
            jdbc.update("INSERT INTO summary_sections(job_id,section_number,heading,category) VALUES (?,?,?,?)",job,section,heading,category);
            for(String input:split(content)) insert(job,0,number++,section,input);
            section++;
        }
        if(number==0) throw new IllegalStateException("Document has no prepared parts");
        jdbc.update("UPDATE summary_jobs SET pipeline_version=2 WHERE id=?",job);
    }
    private void insert(UUID job,int round,int number,int section,String input) {
        jdbc.update("INSERT INTO summary_steps(job_id,round_number,step_number,section_number,input_text) VALUES (?,?,?,?,?)",job,round,number,section,input);
    }
    public void tick() {
        transaction.executeWithoutResult(tx -> {
            var throttle=jdbc.queryForList("SELECT id FROM llm_throttle WHERE id=1 AND next_call_at<=CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED");
            if(throttle.isEmpty()) return;
            var jobs=jdbc.queryForList("SELECT * FROM summary_jobs WHERE status IN ('queued','running','waiting') AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
            if(jobs.isEmpty()) return;
            var job=jobs.getFirst(); UUID id=(UUID)job.get("id"); int round=((Number)job.get("round_number")).intValue();
            var steps=jdbc.queryForList("SELECT step_number,input_text,section_number,repair_text FROM summary_steps WHERE job_id=? AND round_number=? AND output_text IS NULL ORDER BY step_number LIMIT 1",id,round);
            if(steps.isEmpty()) { finishRound(job); return; }
            var step=steps.getFirst();
            String mode="fragment";
            if(((Number)step.get("section_number")).intValue()==-1 && jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=? AND round_number=?",Integer.class,id,round)==1) mode="overview_"+job.get("compression_level");
            String repair=(String)step.get("repair_text");
            try {
                String model=(String)job.get("model_name");
                if(settings!=null && settings.model()!=null && !model.equals(settings.model())) {
                    model=settings.model();
                    jdbc.update("UPDATE summary_jobs SET model_name=? WHERE id=?",model,id);
                }
                var result=summarizer.summarize(repair==null?(String)step.get("input_text"):repair,repair==null?mode:"repair_"+mode,model);
                if(result.text().isBlank() || result.text().length()>DeepSeekSummarizer.outputLimit(mode)) throw new Summarizer.Failure("Ответ модели не соответствует объёму.",true,result.retrySeconds(),result.tokens(),null);
                jdbc.update("UPDATE summary_steps SET output_text=?,repair_text=NULL WHERE job_id=? AND round_number=? AND step_number=?",result.text(),id,round,step.get("step_number"));
                jdbc.update("UPDATE summary_jobs SET status='running',attempts=0,error_message=NULL,tokens_used=tokens_used+?,updated_at=CURRENT_TIMESTAMP WHERE id=?",result.tokens(),id);
                cooldown(result.retrySeconds());
                if(jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=? AND round_number=? AND output_text IS NULL",Integer.class,id,round)==0) finishRound(job);
            } catch(Summarizer.Failure failure) {
                int attempts=((Number)job.get("attempts")).intValue()+1;
                long delay=Math.max(1,Math.min(86400,failure.retrySeconds));
                // Quota waits do not exhaust content retries, including a daily quota pause.
                boolean quota=failure.code.equals("RATE_LIMIT");
                jdbc.update("UPDATE summary_jobs SET status=?,attempts=?,tokens_used=tokens_used+?,error_message=?,next_attempt_at=clock_timestamp() + (? * interval '1 second'),updated_at=CURRENT_TIMESTAMP WHERE id=?",failure.retryable && (quota || attempts<5)?"waiting":"failed",quota?0:attempts,failure.tokens,failure.getMessage(),delay,id);
                if(failure.repairText!=null) jdbc.update("UPDATE summary_steps SET repair_text=? WHERE job_id=? AND round_number=? AND step_number=?",failure.repairText,id,round,step.get("step_number"));
                cooldown(delay);
            }
        });
    }
    private void cooldown(long seconds) { jdbc.update("UPDATE llm_throttle SET next_call_at=clock_timestamp()+(? * interval '1 second') WHERE id=1",Math.max(1,seconds)); }
    private void finishRound(Map<String,Object> job) {
        UUID id=(UUID)job.get("id"); int round=((Number)job.get("round_number")).intValue();
        var rows=jdbc.queryForList("SELECT section_number,output_text FROM summary_steps WHERE job_id=? AND round_number=? ORDER BY step_number",id,round);
        if(rows.isEmpty() || rows.stream().anyMatch(r->r.get("output_text")==null)) return;
        var groups=new LinkedHashMap<Integer,List<String>>();
        for(var row:rows) groups.computeIfAbsent(((Number)row.get("section_number")).intValue(),k->new ArrayList<>()).add((String)row.get("output_text"));
        if(groups.containsKey(-1) && rows.size()==1) {
            UUID result=UUID.randomUUID();String level=(String)job.get("compression_level");
            jdbc.update("INSERT INTO summaries(id,document_id,summary_text,compression_level,compression_percent,algorithm,model_name) VALUES (?,?,?,?,?,'deepseek-chapters-v2',?)",result,job.get("document_id"),rows.getFirst().get("output_text"),level,switch(level){case "short"->20;case "detailed"->50;default->35;},job.get("model_name"));
            jdbc.update("UPDATE summary_jobs SET status='ready',result_id=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",result,id);
            return;
        }
        int number=0;
        for(var group:groups.entrySet()) {
            if(group.getKey()!=-1 && group.getValue().size()==1) {
                jdbc.update("UPDATE summary_sections SET summary_text=? WHERE job_id=? AND section_number=?",group.getValue().getFirst(),id,group.getKey());
            } else {
                for(String input:pack(group.getValue())) insert(id,round+1,number++,group.getKey(),input);
            }
        }
        if(number==0) {
            var sections=jdbc.queryForList("SELECT heading,summary_text FROM summary_sections WHERE job_id=? AND category='main' ORDER BY section_number",id);
            if(sections.isEmpty()) sections=jdbc.queryForList("SELECT heading,summary_text FROM summary_sections WHERE job_id=? ORDER BY section_number",id);
            var inputs=new ArrayList<String>();
            for(var section:sections) inputs.add("Раздел: "+section.get("heading")+"\n"+section.get("summary_text"));
            for(String input:pack(inputs)) insert(id,round+1,number++,-1,input);
        }
        jdbc.update("UPDATE summary_jobs SET round_number=round_number+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",id);
    }
    private List<String> pack(List<String> outputs) {
        var batches=new ArrayList<String>();var current=new StringBuilder();
        for(String output:outputs) {
            if(!current.isEmpty() && (current+"\n\n"+output).getBytes(StandardCharsets.UTF_8).length>INPUT_BYTES) { batches.add(current.toString());current.setLength(0); }
            if(!current.isEmpty()) current.append("\n\n");current.append(output);
        }
        if(!current.isEmpty()) batches.add(current.toString());return batches;
    }
}

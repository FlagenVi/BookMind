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
    // A conservative byte bound below DeepSeek Flash's 1M-token context window.
    public static final int DIRECT_INPUT_BYTES=700_000;
    private static final Pattern HEADING=Pattern.compile("(?imU)^[ \\t]*(?:(?:глава|часть|раздел|chapter|part|section)\\b[^\\r\\n]{0,260}|(?:предисловие|введение|примечания|сноски|послесловие)[ \\t]*)$");
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
        return split(text,INPUT_BYTES);
    }
    private static List<String> split(String text,int limit) {
        var result=new ArrayList<String>(); int start=0,bytes=0,index=0;
        while(index<text.length()) {
            int point=text.codePointAt(index); int length=new String(Character.toChars(point)).getBytes(StandardCharsets.UTF_8).length;
            if(bytes+length>limit) {
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
        initialize(job,document,"whole",-1);
    }
    public void initialize(UUID job,UUID document,String scope,int selectedSection) {
        String text=jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?",String.class,document);
        String format=jdbc.queryForObject("SELECT source_type FROM documents WHERE id=?",String.class,document);
        var chapters=new ArrayList<ChapterPart>();
        if(Set.of("fb2","epub").contains(format)) {
            var bookSections=jdbc.queryForList("SELECT section_number,title,role,content FROM reader_sections WHERE document_id=? ORDER BY section_number",document);
            if(!bookSections.isEmpty()) {
                int section=0;
                boolean hasLaterMain=bookSections.stream().filter(row->"main".equals(row.get("role"))).count()>1;
                for(var row:bookSections) {
                    int sourceNumber=((Number)row.get("section_number")).intValue();
                    if("chapter".equals(scope) && sourceNumber!=selectedSection) continue;
                    if("through_chapter".equals(scope) && sourceNumber>selectedSection) continue;
                    String content=(String)row.get("content");
                    if(!"main".equals(row.get("role")) || content==null || content.isBlank()
                            || (!"chapter".equals(scope) && isShortUntitledOpening(section,(String)row.get("title"),content,hasLaterMain))) continue;
                    String heading=((String)row.get("title")).strip();
                    chapters.addAll(structuredParts(heading,content));
                    section++;
                }
            }
        }
        if(chapters.isEmpty()) {
            if(!"whole".equals(scope)) throw new IllegalArgumentException("Selected chapter has no readable text");
            chapters.add(new ChapterPart("Материал",text));
        }
        String whole=chapterText(chapters);
        if(whole.isBlank()) throw new IllegalStateException("Document has no prepared text");
        if(whole.getBytes(StandardCharsets.UTF_8).length<=DIRECT_INPUT_BYTES) {
            insert(job,0,0,-1,whole);
        } else {
            int number=0;
            for(var volume:volumes(chapters)) {
                jdbc.update("INSERT INTO summary_sections(job_id,section_number,heading,category) VALUES (?,?,?,'main')",job,number,volume.heading());
                insert(job,0,number,number,volume.content());
                number++;
            }
        }
        jdbc.update("UPDATE summary_jobs SET pipeline_version=4 WHERE id=?",job);
    }
    private static String chapterText(List<ChapterPart> chapters) {
        var text=new StringBuilder();
        for(var chapter:chapters) {
            if(!text.isEmpty()) text.append("\n\n");
            text.append(chapter.heading()).append("\n").append(chapter.content());
        }
        return text.toString();
    }
    private record Volume(String heading,String content) {}
    private record VolumePiece(int chapterNumber,ChapterPart part) {}
    private static List<Volume> volumes(List<ChapterPart> chapters) {
        var pieces=new ArrayList<VolumePiece>();
        for(int chapterIndex=0;chapterIndex<chapters.size();chapterIndex++) {
            var chapter=chapters.get(chapterIndex);
            String heading=chapter.heading();
            int room=DIRECT_INPUT_BYTES-2048;
            if((heading+"\n"+chapter.content()).getBytes(StandardCharsets.UTF_8).length<=room) pieces.add(new VolumePiece(chapterIndex+1,chapter));
            else {
                var chunks=split(chapter.content(),room);
                for(int i=0;i<chunks.size();i++) pieces.add(new VolumePiece(chapterIndex+1,new ChapterPart(heading+" (часть "+(i+1)+" из "+chunks.size()+")",chunks.get(i))));
            }
        }
        var result=new ArrayList<Volume>();var current=new ArrayList<ChapterPart>();int first=0;
        for(int i=0;i<pieces.size();i++) {
            var piece=pieces.get(i).part();
            var candidate=new ArrayList<>(current);candidate.add(piece);
            if(!current.isEmpty() && (candidate.size()>10 || chapterText(candidate).getBytes(StandardCharsets.UTF_8).length>DIRECT_INPUT_BYTES)) {
                result.add(new Volume(volumeHeading(pieces.get(first).chapterNumber(),pieces.get(i-1).chapterNumber()),chapterText(current)));
                current.clear();first=i;
            }
            current.add(piece);
        }
        if(!current.isEmpty()) result.add(new Volume(volumeHeading(pieces.get(first).chapterNumber(),pieces.getLast().chapterNumber()),chapterText(current)));
        return result;
    }
    private static String volumeHeading(int first,int last) { return first==last?"Глава "+first:"Главы "+first+"–"+last; }
    private static boolean isShortUntitledOpening(int section,String title,String content,boolean hasLaterMain) {
        return hasLaterMain && section==0 && content.length()<200 && title!=null && title.matches("(?iu)(?:Раздел|Section)\\s*1");
    }
    private record ChapterPart(String heading,String content) {}
    private static List<ChapterPart> structuredParts(String title,String content) {
        var matcher=HEADING.matcher(content);
        var starts=new ArrayList<Integer>();var headings=new ArrayList<String>();
        while(matcher.find()) {starts.add(matcher.start());headings.add(matcher.group().strip());}
        if(starts.size()<2) return List.of(new ChapterPart(title,content));
        var parts=new ArrayList<ChapterPart>();
        if(starts.getFirst()>0 && !content.substring(0,starts.getFirst()).isBlank())
            parts.add(new ChapterPart(title,content.substring(0,starts.getFirst())));
        for(int i=0;i<starts.size();i++) {
            String value=content.substring(starts.get(i),i+1<starts.size()?starts.get(i+1):content.length());
            if(!value.isBlank()) parts.add(new ChapterPart(headings.get(i),value));
        }
        return parts;
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
            if(round==0 && ((Number)job.get("pipeline_version")).intValue()==2) reconcileLegacyBookSections(id,(UUID)job.get("document_id"));
            var steps=jdbc.queryForList("SELECT step_number,input_text,section_number,repair_text FROM summary_steps WHERE job_id=? AND round_number=? AND output_text IS NULL ORDER BY step_number LIMIT 1",id,round);
            if(steps.isEmpty()) { finishRound(job); return; }
            var step=steps.getFirst();
            String mode=((Number)job.get("pipeline_version")).intValue()>=4?"direct_"+job.get("compression_level"):"fragment";
            if(((Number)job.get("pipeline_version")).intValue()<4 && ((Number)step.get("section_number")).intValue()==-1 && jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=? AND round_number=?",Integer.class,id,round)==1) mode="overview_"+job.get("compression_level");
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
    private void reconcileLegacyBookSections(UUID job,UUID document) {
        String format=jdbc.queryForObject("SELECT source_type FROM documents WHERE id=?",String.class,document);
        if(!Set.of("fb2","epub").contains(format)) return;
        var bookSections=jdbc.queryForList("SELECT start_offset,end_offset,title,role,content FROM reader_sections WHERE document_id=? ORDER BY section_number",document);
        if(bookSections.isEmpty()) return;
        boolean hasLaterMain=bookSections.stream().filter(row->"main".equals(row.get("role"))).count()>1;
        String text=jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?",String.class,document);
        var sections=jdbc.queryForList("SELECT s.section_number,p.input_text FROM summary_sections s JOIN summary_steps p ON p.job_id=s.job_id AND p.section_number=s.section_number AND p.round_number=0 WHERE s.job_id=? AND p.step_number=(SELECT min(q.step_number) FROM summary_steps q WHERE q.job_id=s.job_id AND q.section_number=s.section_number AND q.round_number=0) ORDER BY s.section_number",job);
        int cursor=0;
        for(var section:sections) {
            String input=(String)section.get("input_text");
            int position=text.indexOf(input,cursor);
            if(position<0) continue;
            cursor=position+input.length();
            int sectionNumber=((Number)section.get("section_number")).intValue();
            for(var book:bookSections) {
                int start=((Number)book.get("start_offset")).intValue(),end=((Number)book.get("end_offset")).intValue();
                if(position<start || position>=end) continue;
                if(!"main".equals(book.get("role")) || isShortUntitledOpening(sectionNumber,(String)book.get("title"),(String)book.get("content"),hasLaterMain)) {
                    jdbc.update("DELETE FROM summary_steps WHERE job_id=? AND section_number=?",job,sectionNumber);
                    jdbc.update("DELETE FROM summary_sections WHERE job_id=? AND section_number=?",job,sectionNumber);
                }
                break;
            }
        }
        jdbc.update("UPDATE summary_jobs SET pipeline_version=3 WHERE id=?",job);
    }
    private void finishDirectRound(Map<String,Object> job) {
        UUID id=(UUID)job.get("id");int round=((Number)job.get("round_number")).intValue();
        var rows=jdbc.queryForList("SELECT section_number,output_text FROM summary_steps WHERE job_id=? AND round_number=? ORDER BY step_number",id,round);
        if(rows.isEmpty() || rows.stream().anyMatch(row->row.get("output_text")==null)) return;
        if(rows.size()==1 && ((Number)rows.getFirst().get("section_number")).intValue()==-1) {
            UUID result=UUID.randomUUID();String level=(String)job.get("compression_level");
            jdbc.update("INSERT INTO summaries(id,document_id,summary_text,compression_level,compression_percent,algorithm,model_name) VALUES (?,?,?,?,?,'deepseek-long-context-v1',?)",result,job.get("document_id"),rows.getFirst().get("output_text"),level,switch(level){case "short"->20;case "detailed"->50;default->35;},job.get("model_name"));
            jdbc.update("UPDATE summary_jobs SET status='ready',result_id=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",result,id);
            return;
        }
        var outputs=new ArrayList<String>();
        for(var row:rows) {
            int section=((Number)row.get("section_number")).intValue();
            String output=(String)row.get("output_text");
            if(round==0 && section>=0) {
                jdbc.update("UPDATE summary_sections SET summary_text=? WHERE job_id=? AND section_number=?",output,id,section);
                String heading=jdbc.queryForObject("SELECT heading FROM summary_sections WHERE job_id=? AND section_number=?",String.class,id,section);
                outputs.add(heading+"\n"+output);
            } else outputs.add(output);
        }
        int number=0;
        for(String input:pack(outputs,DIRECT_INPUT_BYTES)) insert(id,round+1,number++,-1,input);
        jdbc.update("UPDATE summary_jobs SET round_number=round_number+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",id);
    }
    private void finishRound(Map<String,Object> job) {
        if(((Number)job.get("pipeline_version")).intValue()>=4) { finishDirectRound(job);return; }
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
        return pack(outputs,INPUT_BYTES);
    }
    private List<String> pack(List<String> outputs,int limit) {
        var batches=new ArrayList<String>();var current=new StringBuilder();
        for(String output:outputs) {
            if(!current.isEmpty() && (current+"\n\n"+output).getBytes(StandardCharsets.UTF_8).length>limit) { batches.add(current.toString());current.setLength(0); }
            if(!current.isEmpty()) current.append("\n\n");current.append(output);
        }
        if(!current.isEmpty()) batches.add(current.toString());return batches;
    }
}

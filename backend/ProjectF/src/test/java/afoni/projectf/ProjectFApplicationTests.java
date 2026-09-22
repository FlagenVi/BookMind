package afoni.projectf;

import afoni.projectf.model.Note;
import afoni.projectf.service.NoteService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.DriverManager;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import com.jayway.jsonpath.JsonPath;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
import jakarta.servlet.http.Cookie;
import org.springframework.http.MediaType;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@SpringBootTest(properties = "spring.config.location=classpath:/application-test.properties")
class ProjectFApplicationTests {
    @Container
    static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:17-alpine")
            .withPassword(UUID.randomUUID().toString());

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", database::getJdbcUrl);
        registry.add("spring.datasource.username", database::getUsername);
        registry.add("spring.datasource.password", database::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired NoteService notes;
    @Autowired Flyway flyway;
    @Autowired MockMvc mvc;
    @Autowired afoni.projectf.service.DocumentPreparation preparation;
    @Autowired afoni.projectf.service.BookImportService bookImports;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @org.springframework.test.context.bean.override.mockito.MockitoBean
    afoni.projectf.service.LlmSettings llmSettings;
    @org.springframework.test.context.bean.override.mockito.MockitoBean
    afoni.projectf.service.BookChatClient bookChatClient;

    @Test void bookChatKeepsSourcesWithinSavedPositionAndNeverRepeatsARequestId() throws Exception {
        org.mockito.Mockito.when(llmSettings.configured()).thenReturn(true);
        org.mockito.Mockito.when(llmSettings.model()).thenReturn("deepseek-flash");
        String email=UUID.randomUUID()+"@example.test";
        var owner=registerAccount(email,UUID.randomUUID().toString());
        var stranger=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        UUID user=jdbc.queryForObject("SELECT id FROM users WHERE email=?",UUID.class,email);
        UUID book=UUID.randomUUID();
        String text="Герой находит письмо. ".repeat(40)+"СЕКРЕТНЫЙ_ФИНАЛ";
        int confirmed=text.indexOf("СЕКРЕТНЫЙ_ФИНАЛ");
        jdbc.update("INSERT INTO documents(id,user_id,title,original_text,source_type,material_type,author) VALUES (?,?,?,?,'epub','BOOK',?)",
                book,user,"Тестовая книга",text,"Автор");
        jdbc.update("INSERT INTO reading_progress(user_id,document_id,position_offset,confirmed_offset) VALUES (?,?,?,?)",
                user,book,confirmed,confirmed);
        String path="/api/books/"+book+"/chats";
        mvc.perform(get(path).session(stranger)).andExpect(status().isNotFound());
        mvc.perform(post(path).session(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isCreated());
        UUID thread=jdbc.queryForObject("SELECT id FROM book_chat_threads WHERE document_id=?",UUID.class,book);
        mvc.perform(get(path+"/"+thread+"/turns").session(stranger)).andExpect(status().isNotFound());
        UUID anotherBook=UUID.randomUUID();
        jdbc.update("INSERT INTO documents(id,user_id,title,original_text,source_type,material_type) VALUES (?,?,?,'Другая книга','epub','BOOK')",
                anotherBook,user,"Другая книга");
        mvc.perform(get("/api/books/"+anotherBook+"/chats/"+thread+"/turns").session(owner)).andExpect(status().isNotFound());
        org.mockito.Mockito.verifyNoInteractions(bookChatClient);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        var sent=new java.util.concurrent.atomic.AtomicReference<String>();
        var sentMessageCount=new java.util.concurrent.atomic.AtomicInteger();
        org.mockito.Mockito.when(bookChatClient.answer(org.mockito.ArgumentMatchers.anyList(),org.mockito.ArgumentMatchers.eq("deepseek-flash")))
                .thenAnswer(invocation->{
                    java.util.List<afoni.projectf.service.BookChatClient.Message> messages=invocation.getArgument(0);
                    sent.set(messages.getLast().content());sentMessageCount.set(messages.size());calls.incrementAndGet();
                    return new afoni.projectf.service.BookChatClient.Result("Герой находит письмо [1].",120,35);
                });
        UUID first=UUID.randomUUID();
        String grounded="{\"id\":\""+first+"\",\"mode\":\"grounded\",\"question\":\"Что находит герой?\"}";
        for(int i=0;i<2;i++) mvc.perform(post(path+"/"+thread+"/turns").session(owner).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(grounded))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready"))
                .andExpect(jsonPath("$.references[0].endOffset").value(confirmed));
        assertEquals(1,calls.get());
        assertTrue(sent.get().contains("Герой находит письмо"));
        assertFalse(sent.get().contains("СЕКРЕТНЫЙ_ФИНАЛ"));
        assertFalse(jdbc.queryForObject("SELECT source_excerpt FROM book_chat_turns WHERE id=?",String.class,first).contains("СЕКРЕТНЫЙ_ФИНАЛ"));
        UUID second=UUID.randomUUID();
        mvc.perform(post(path+"/"+thread+"/turns").session(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\""+second+"\",\"mode\":\"model_knowledge\",\"question\":\"Кто автор?\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mode").value("model_knowledge"))
                .andExpect(jsonPath("$.references.length()").value(0));
        assertEquals(2,calls.get());
        assertFalse(sent.get().contains("Герой находит письмо"));
        assertNull(jdbc.queryForObject("SELECT source_excerpt FROM book_chat_turns WHERE id=?",String.class,second));
        jdbc.update("UPDATE reading_progress SET position_offset=0,confirmed_offset=0 WHERE user_id=? AND document_id=?",user,book);
        UUID selectedTurn=UUID.randomUUID();
        mvc.perform(post(path+"/"+thread+"/turns").session(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\""+selectedTurn+"\",\"mode\":\"model_knowledge\",\"question\":\"Что означает выделенный фрагмент?\",\"selectedStart\":0,\"selectedEnd\":5,\"selectedText\":\"Герой\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready"))
                .andExpect(jsonPath("$.mode").value("grounded"))
                .andExpect(jsonPath("$.positionOffset").value(5))
                .andExpect(jsonPath("$.references.length()").value(1));
        assertEquals(3,calls.get());
        assertEquals(2,sentMessageCount.get());
        assertTrue(sent.get().contains("Книга: Тестовая книга. Автор: Автор."));
        assertTrue(sent.get().contains("Выделенный пользователем фрагмент:\n<<<\nГерой\n>>>"));
        assertTrue(jdbc.queryForObject("SELECT source_excerpt FROM book_chat_turns WHERE id=?",String.class,selectedTurn).contains("<<<\nГерой\n>>>"));
        jdbc.update("UPDATE reading_progress SET position_offset=?,confirmed_offset=? WHERE user_id=? AND document_id=?",confirmed,confirmed,user,book);
        org.mockito.Mockito.when(bookChatClient.answer(org.mockito.ArgumentMatchers.anyList(),org.mockito.ArgumentMatchers.eq("deepseek-flash")))
                .thenThrow(new afoni.projectf.service.BookChatClient.Failure("Ответ достиг лимита",80,1200));
        UUID failed=UUID.randomUUID();
        mvc.perform(post(path+"/"+thread+"/turns").session(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\""+failed+"\",\"mode\":\"grounded\",\"question\":\"Что дальше?\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("failed"))
                .andExpect(jsonPath("$.completionTokens").value(1200));
        mvc.perform(get(path+"/"+thread+"/turns").session(owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$[3].status").value("failed"));
        mvc.perform(delete(path+"/"+thread).session(owner).with(csrf())).andExpect(status().isNoContent());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM book_chat_turns WHERE thread_id=?",Integer.class,thread));
        jdbc.update("DELETE FROM documents WHERE id=?",book);
        jdbc.update("DELETE FROM documents WHERE id=?",anotherBook);
    }

    @Test
    void summaryQueueRetriesAndReducesWithoutRepeatingCompletedSteps() throws Exception {
        org.mockito.Mockito.when(llmSettings.configured()).thenReturn(true);
        org.mockito.Mockito.when(llmSettings.model()).thenReturn("deepseek-flash");
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Test\",\"content\":\""+"Русский текст 📚. ".repeat(1000)+"\"}")).andExpect(status().isCreated());
        UUID document=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        String path="/api/documents/"+document+"/summary";
        mvc.perform(post("/api/documents/"+document+"/preparation").session(session).with(csrf())).andExpect(status().isNoContent());
        for(int i=0;i<20;i++) preparation.processNext();
        mvc.perform(get(path).session(other)).andExpect(status().isNotFound());
        mvc.perform(post(path).session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"level\":\"medium\"}")).andExpect(status().isNotFound());
        for(int i=0;i<2;i++) mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"level\":\"medium\"}")).andExpect(status().isNoContent());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM summary_jobs WHERE document_id=?",Integer.class,document));
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"level\":\"short\"}")).andExpect(status().isConflict());
        mvc.perform(get("/api/documents").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].processing.status").value("queued"));
        mvc.perform(get(path+"?level=short").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.activeJob.level").value("medium"));
        mvc.perform(get(path+"/sections/0").session(other)).andExpect(status().isNotFound());
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        afoni.projectf.service.Summarizer fake=(text,level,model)-> {
            assertTrue(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=afoni.projectf.service.SummaryQueue.DIRECT_INPUT_BYTES);
            if(calls.incrementAndGet()==1) throw new afoni.projectf.service.Summarizer.Failure("Квота",true,70);
            return new afoni.projectf.service.Summarizer.Result("Краткое изложение.",50);
        };
        jdbc.update("UPDATE summary_jobs SET model_name='openai/gpt-oss-120b' WHERE document_id=?",document);
        var worker=new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake,llmSettings);
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
        worker.tick();
        assertEquals("deepseek-flash",jdbc.queryForObject("SELECT model_name FROM summary_jobs WHERE document_id=?",String.class,document));
        mvc.perform(get(path).session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("waiting"));
        worker.tick(); assertEquals(1,calls.get());
        for(int i=0;i<40;i++) {
            jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
            jdbc.update("UPDATE summary_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE document_id=?",document);
            new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).tick();
        }
        mvc.perform(get(path).session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready")).andExpect(jsonPath("$.text").value("Краткое изложение."));
        mvc.perform(get(path).session(session)).andExpect(jsonPath("$.sections.length()").value(0));
        long steps=jdbc.queryForObject("SELECT count(*) FROM summary_steps s JOIN summary_jobs j ON j.id=s.job_id WHERE j.document_id=?",Long.class,document);
        assertEquals(steps+1,calls.get());
        assertEquals(steps*50,jdbc.queryForObject("SELECT tokens_used FROM summary_jobs WHERE document_id=?",Long.class,document));
        assertEquals(0,jdbc.queryForObject("SELECT round_number FROM summary_jobs WHERE document_id=?",Integer.class,document));
        mvc.perform(delete("/api/documents/"+document).session(session).with(csrf())).andExpect(status().isNoContent());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM summary_jobs WHERE document_id=?",Integer.class,document));
    }

    @Test
    void txtUploadCheckpointsResumeAndPreservesText() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String text="Глава 1. Начало\n" + "Первый раздел 📚. ".repeat(12000) + "\nГлава 2. Конец\n" + "Второй раздел. ".repeat(1000);
        var file=new org.springframework.mock.web.MockMultipartFile("file","book.txt","text/plain",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/documents/upload").file(file).session(session)).andExpect(status().isForbidden());
        var result=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        String id=JsonPath.read(result.getResponse().getContentAsString(),"$.id");
        UUID uuid=UUID.fromString(id);
        mvc.perform(get("/api/documents/"+id+"/preparation").session(other)).andExpect(status().isNotFound());
        mvc.perform(post("/api/documents/"+id+"/preparation").session(other).with(csrf())).andExpect(status().isNotFound());
        preparation.processNext();
        assertEquals(1,jdbc.queryForObject("SELECT processed_parts FROM document_jobs WHERE document_id=?",Integer.class,uuid));
        jdbc.update("UPDATE document_jobs SET status='failed' WHERE document_id=?",uuid);
        mvc.perform(post("/api/documents/"+id+"/preparation").session(session).with(csrf())).andExpect(status().isNoContent());
        assertEquals(1,jdbc.queryForObject("SELECT processed_parts FROM document_jobs WHERE document_id=?",Integer.class,uuid));
        // A new worker continues from durable checkpoints, with no in-memory task state.
        var restarted=new afoni.projectf.service.DocumentPreparation(jdbc,transactionManager);
        for(int i=0;i<100;i++) restarted.processNext();
        mvc.perform(get("/api/documents/"+id+"/preparation").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready"));
        assertEquals(text,jdbc.queryForObject("SELECT string_agg(content,'' ORDER BY part_number) FROM document_parts WHERE document_id=?",String.class,uuid));
        assertTrue(jdbc.queryForObject("SELECT max(length(content)) FROM document_parts WHERE document_id=?",Integer.class,uuid)<=6000);
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM document_parts WHERE document_id=? AND heading LIKE 'Глава 2%'",Integer.class,uuid)>0);
        mvc.perform(post("/api/documents/"+id+"/preparation").session(session).with(csrf())).andExpect(status().isNoContent());
        restarted.processNext();
        assertEquals(text.length(),jdbc.queryForObject("SELECT next_offset FROM document_jobs WHERE document_id=?",Integer.class,uuid));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM document_parts WHERE document_id=?",Integer.class,uuid));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM document_jobs WHERE document_id=?",Integer.class,uuid));
    }

    @Test void directSummaryRepairSurvivesRestart() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        String source="Глава: Первый рассказ\n"+"Альфа. ".repeat(900)+"\nГлава: Второй рассказ\nБета.\nГлава: Примечания\nСноска.";
        String json=new tools.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of("title","Chapters","content",source));
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(json)).andExpect(status().isCreated());
        UUID doc=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        UUID job=UUID.randomUUID();
        jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name) VALUES (?,?,'detailed','synthetic')",job,doc);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        afoni.projectf.service.Summarizer fake=(text,mode,model)-> {
            if(calls.incrementAndGet()==1) throw new afoni.projectf.service.Summarizer.Failure("Сокращение",true,1,123,"Черновик Альфа");
            assertEquals("repair_direct_detailed",mode);
            assertEquals("Черновик Альфа",text);
            return new afoni.projectf.service.Summarizer.Result("Альфа",10,1);
        };
        new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).initialize(job,doc);
        for(int i=0;i<30;i++) {
            jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
            jdbc.update("UPDATE summary_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=?",job);
            new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).tick();
        }
        assertEquals("ready",jdbc.queryForObject("SELECT status FROM summary_jobs WHERE id=?",String.class,job));
        assertEquals("Альфа",jdbc.queryForObject("SELECT summary_text FROM summaries WHERE id=(SELECT result_id FROM summary_jobs WHERE id=?)",String.class,job));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=?",Integer.class,job));
        assertEquals(123+(calls.get()-1)*10,jdbc.queryForObject("SELECT tokens_used FROM summary_jobs WHERE id=?",Integer.class,job));
        mvc.perform(delete("/api/documents/"+doc).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test void fb2SummariesUseBookChaptersAndDropLegacyFootnotesWithoutLosingProgress() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String xml="<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'>"+
                "<description><title-info><book-title>Книга</book-title></title-info></description>"+
                "<body><section><p>Копирайт.</p></section>"+
                "<section><title><p>Первая часть</p></title><p>Первый сюжет.</p></section>"+
                "<section><title><p>Вторая часть</p></title><p>Второй сюжет.</p></section></body>"+
                "<body name='notes'><section><title><p>1</p></title><p>Сноска один.</p></section></body></FictionBook>";
        var file=new org.springframework.mock.web.MockMultipartFile("file","story.fb2","application/xml",xml.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var upload=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        UUID document=UUID.fromString(JsonPath.read(upload.getResponse().getContentAsString(),"$.id"));
        var book=jdbc.queryForList("SELECT section_number,title,role,content FROM reader_sections WHERE document_id=? ORDER BY section_number",document);
        assertEquals(4,book.size());
        assertEquals("auxiliary",book.get(3).get("role"));

        UUID job=UUID.randomUUID();
        jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name) VALUES (?,?,'medium','synthetic')",job,document);
        var queue=new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,(text,level,model)->new afoni.projectf.service.Summarizer.Result("Кратко.",10));
        queue.initialize(job,document);
        assertEquals(4,jdbc.queryForObject("SELECT pipeline_version FROM summary_jobs WHERE id=?",Integer.class,job));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM summary_sections WHERE job_id=?",Integer.class,job));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=?",Integer.class,job));
        String input=jdbc.queryForObject("SELECT input_text FROM summary_steps WHERE job_id=?",String.class,job);
        assertTrue(input.contains("Первый сюжет") && input.contains("Второй сюжет"));
        assertFalse(input.contains("Сноска один") || input.contains("Копирайт"));
        jdbc.update("DELETE FROM summary_jobs WHERE id=?",job);

        org.mockito.Mockito.when(llmSettings.configured()).thenReturn(true);
        org.mockito.Mockito.when(llmSettings.model()).thenReturn("deepseek-flash");
        String path="/api/documents/"+document+"/summary";
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"short\",\"scope\":\"chapter\",\"sectionNumber\":3}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"short\",\"scope\":\"chapter\",\"sectionNumber\":1}"))
                .andExpect(status().isNoContent());
        mvc.perform(get(path+"?level=short&scope=chapter&sectionNumber=1").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.pipelineVersion").value(4));
        String chapterInput=jdbc.queryForObject("SELECT p.input_text FROM summary_steps p JOIN summary_jobs j ON j.id=p.job_id WHERE j.document_id=? AND j.scope_mode='chapter'",String.class,document);
        assertTrue(chapterInput.contains("Первый сюжет"));assertFalse(chapterInput.contains("Второй сюжет"));
        jdbc.update("DELETE FROM summary_jobs WHERE document_id=? AND scope_mode='chapter'",document);
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"short\",\"scope\":\"through_chapter\",\"sectionNumber\":2}"))
                .andExpect(status().isNoContent());
        String throughInput=jdbc.queryForObject("SELECT p.input_text FROM summary_steps p JOIN summary_jobs j ON j.id=p.job_id WHERE j.document_id=? AND j.scope_mode='through_chapter'",String.class,document);
        assertTrue(throughInput.contains("Первый сюжет") && throughInput.contains("Второй сюжет"));
        assertFalse(throughInput.contains("Сноска один"));
        jdbc.update("DELETE FROM summary_jobs WHERE document_id=? AND scope_mode='through_chapter'",document);

        UUID legacy=UUID.randomUUID();
        jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name,pipeline_version) VALUES (?,?,'medium','synthetic',2)",legacy,document);
        for(int i=0;i<book.size();i++) {
            jdbc.update("INSERT INTO summary_sections(job_id,section_number,heading,category) VALUES (?,?,?,'main')",legacy,i,i==0?"Начало документа":"Глава: "+book.get(i).get("title"));
            jdbc.update("INSERT INTO summary_steps(job_id,round_number,step_number,section_number,input_text,output_text) VALUES (?,0,?,?,?,?)",
                    legacy,i,i,book.get(i).get("content"),i==1?"Уже готовый пересказ":null);
        }
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
        queue.tick();
        assertEquals(3,jdbc.queryForObject("SELECT pipeline_version FROM summary_jobs WHERE id=?",Integer.class,legacy));
        assertEquals(java.util.List.of("Глава: Первая часть","Глава: Вторая часть"),jdbc.queryForList("SELECT heading FROM summary_sections WHERE job_id=? ORDER BY section_number",String.class,legacy));
        assertEquals("Уже готовый пересказ",jdbc.queryForObject("SELECT output_text FROM summary_steps WHERE job_id=? AND section_number=1",String.class,legacy));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=? AND section_number=3",Integer.class,legacy));
        jdbc.update("UPDATE summary_jobs SET status='failed' WHERE id=?",legacy);
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"medium\"}"))
                .andExpect(status().isNoContent());
        assertEquals(4,jdbc.queryForObject("SELECT pipeline_version FROM summary_jobs WHERE id=?",Integer.class,legacy));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=?",Integer.class,legacy));
        mvc.perform(delete("/api/documents/"+document).session(session).with(csrf())).andExpect(status().isNoContent());
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
    }

    @Test void oversizedMaterialUsesVolumesAndOneFinalSynthesis() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Большой материал\",\"content\":\"Начало\"}")).andExpect(status().isCreated());
        UUID document=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        jdbc.update("UPDATE documents SET original_text=? WHERE id=?","Сюжет и события. ".repeat(50_000),document);
        UUID job=UUID.randomUUID();
        jdbc.update("INSERT INTO summary_jobs(id,document_id,compression_level,model_name) VALUES (?,?,'medium','synthetic')",job,document);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        afoni.projectf.service.Summarizer fake=(input,mode,model)->{
            assertTrue(input.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=afoni.projectf.service.SummaryQueue.DIRECT_INPUT_BYTES);
            assertEquals("direct_medium",mode);
            calls.incrementAndGet();
            return new afoni.projectf.service.Summarizer.Result("Краткий том.",10,1);
        };
        var queue=new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake);
        queue.initialize(job,document);
        int volumes=jdbc.queryForObject("SELECT count(*) FROM summary_steps WHERE job_id=? AND round_number=0",Integer.class,job);
        assertTrue(volumes>1);
        for(int i=0;i<volumes+3;i++) {
            jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
            queue.tick();
        }
        assertEquals("ready",jdbc.queryForObject("SELECT status FROM summary_jobs WHERE id=?",String.class,job));
        assertEquals(volumes+1,calls.get());
        assertEquals(volumes,jdbc.queryForObject("SELECT count(*) FROM summary_sections WHERE job_id=? AND summary_text IS NOT NULL",Integer.class,job));
        mvc.perform(delete("/api/documents/"+document).session(session).with(csrf())).andExpect(status().isNoContent());
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
    }

    @Test void truncatedDirectAnswerIsVisibleAndRequiresExplicitFullRetry() throws Exception {
        org.mockito.Mockito.when(llmSettings.configured()).thenReturn(true);
        org.mockito.Mockito.when(llmSettings.model()).thenReturn("deepseek-flash");
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Тест\",\"content\":\"Длинный исходный материал для пересказа\"}"))
                .andExpect(status().isCreated());
        UUID document=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        String path="/api/documents/"+document+"/summary";
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"detailed\"}")).andExpect(status().isNoContent());
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        afoni.projectf.service.Summarizer fake=(input,mode,model)->{
            if(calls.incrementAndGet()==1) {
                assertEquals("direct_detailed",mode);
                assertTrue(input.contains("Длинный исходный материал"));
                throw new afoni.projectf.service.Summarizer.Failure("OUTPUT_LIMIT","Модель исчерпала бюджет ответа; черновик сохранён.",false,1,18000,"Черновик без конца книги.");
            }
            assertEquals("direct_detailed",mode);
            assertTrue(input.contains("Длинный исходный материал"));
            return new afoni.projectf.service.Summarizer.Result("Полный пересказ источника.",32,1);
        };
        var queue=new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake);
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
        queue.tick();
        mvc.perform(get(path+"?level=detailed").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("failed"))
                .andExpect(jsonPath("$.partialText").value("Черновик без конца книги."))
                .andExpect(jsonPath("$.tokensUsed").value(18000));
        assertEquals(1,calls.get());
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"level\":\"detailed\"}")).andExpect(status().isNoContent());
        assertNull(jdbc.queryForObject("SELECT p.repair_text FROM summary_steps p JOIN summary_jobs j ON j.id=p.job_id WHERE j.document_id=?",String.class,document));
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
        queue.tick();
        assertEquals(2,calls.get());
        mvc.perform(get(path+"?level=detailed").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ready"))
                .andExpect(jsonPath("$.text").value("Полный пересказ источника."))
                .andExpect(jsonPath("$.partialText").doesNotExist());
        mvc.perform(delete("/api/documents/"+document).session(session).with(csrf())).andExpect(status().isNoContent());
        jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
    }

    @Test
    void ebookUploadsAreStoredAndPrepared() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        for(String format:java.util.List.of("epub","fb2")) {
            byte[] bytes=format.equals("fb2") ? afoni.projectf.service.BookTextExtractorTests.fb2() : afoni.projectf.service.BookTextExtractorTests.epub(afoni.projectf.service.BookTextExtractorTests.entries());
            var file=new org.springframework.mock.web.MockMultipartFile("file","book."+format.toUpperCase(java.util.Locale.ROOT),"application/octet-stream",bytes);
            var result=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf())).andExpect(status().isAccepted()).andReturn();
            UUID id=UUID.fromString(JsonPath.read(result.getResponse().getContentAsString(),"$.id"));
            assertEquals("BOOK",JsonPath.read(result.getResponse().getContentAsString(),"$.materialType"));
            assertEquals(format,jdbc.queryForObject("SELECT source_type FROM documents WHERE id=?",String.class,id));
            assertEquals("BOOK",jdbc.queryForObject("SELECT material_type FROM documents WHERE id=?",String.class,id));
            String text=jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?",String.class,id);
            assertTrue(text.contains("Привет мир!"));
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM reader_sections WHERE document_id=?",Integer.class,id)>0);
            mvc.perform(get("/api/books/"+id+"/manifest").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.sections[0].role").value("main"));
            mvc.perform(get("/api/books/"+id+"/sections/0").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.content").isNotEmpty());
            mvc.perform(get("/api/books/"+id+"/content").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$[0].content").isNotEmpty());
            mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"positionOffset\":0,\"sectionNumber\":0,\"sectionOffset\":2,\"version\":0}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.positionOffset").value(2))
                    .andExpect(jsonPath("$.sectionNumber").value(0)).andExpect(jsonPath("$.sectionOffset").value(2));
            for(int i=0;i<10;i++) preparation.processNext();
            assertEquals(text,jdbc.queryForObject("SELECT string_agg(content,'' ORDER BY part_number) FROM document_parts WHERE document_id=?",String.class,id));
            mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
        }
    }

    @Test
    void materialTypesSeparateListsAndContextsFreezeTheirSourceRange() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        String content="Глава первая\n"+"Прочитанный текст. ".repeat(20)+"\nГлава вторая\nНепрочитанный текст.";
        String json=new tools.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of("title","Документ","content",content));
        var created=mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.materialType").value("DOCUMENT")).andReturn();
        UUID id=UUID.fromString(JsonPath.read(created.getResponse().getContentAsString(),"$.id"));
        mvc.perform(get("/api/documents").session(session)).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/books").session(session)).andExpect(jsonPath("$.totalElements").value(0));
        var snapshot=mvc.perform(post("/api/materials/"+id+"/contexts").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mode\":\"full_document\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.content").value(content))
                .andExpect(jsonPath("$.materialType").value("DOCUMENT")).andReturn();
        String contextId=JsonPath.read(snapshot.getResponse().getContentAsString(),"$.id");
        jdbc.update("UPDATE documents SET original_text='Изменённый текст' WHERE id=?",id);
        mvc.perform(get("/api/materials/"+id+"/contexts/"+contextId).session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content").value(content));
        mvc.perform(post("/api/materials/"+id+"/contexts").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mode\":\"whole_book\",\"includeUnread\":true}"))
                .andExpect(status().isBadRequest());
        jdbc.update("UPDATE documents SET material_type='BOOK' WHERE id=?",id);
        mvc.perform(get("/api/documents").session(session)).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/books").session(session)).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(post("/api/materials/"+id+"/contexts").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mode\":\"whole_book\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/materials/"+id+"/contexts").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mode\":\"whole_book\",\"includeUnread\":true}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.content").value("Изменённый текст"));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void bookSearchPaginatesInUtf16OrderAndRequiresOwner() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String text="😀 "+"Начало ".repeat(20)+"Искомое, затем искомое и в конце ИСКОМОЕ."+" Конец".repeat(20);
        var file=new org.springframework.mock.web.MockMultipartFile("file","search.txt","text/plain",text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var uploaded=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        String id=JsonPath.read(uploaded.getResponse().getContentAsString(),"$.id");
        int second=text.indexOf("искомое");
        var secondPage=mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","  искомое  ").param("offset","1").param("limit","1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.query").value("искомое"))
                .andExpect(jsonPath("$.total").value(3)).andExpect(jsonPath("$.offset").value(1)).andExpect(jsonPath("$.limit").value(1))
                .andExpect(jsonPath("$.items.length()").value(1)).andExpect(jsonPath("$.items[0].index").value(1))
                .andExpect(jsonPath("$.items[0].sectionNumber").value(0)).andExpect(jsonPath("$.items[0].sectionOffset").value(second))
                .andExpect(jsonPath("$.items[0].positionOffset").value(second)).andExpect(jsonPath("$.items[0].length").value("искомое".length()))
                .andExpect(jsonPath("$.items[0].content").doesNotExist()).andReturn();
        String response=secondPage.getResponse().getContentAsString();
        String excerpt=JsonPath.read(response,"$.items[0].excerpt");
        int excerptStart=((Number)JsonPath.read(response,"$.items[0].excerptMatchStart")).intValue();
        int excerptEnd=((Number)JsonPath.read(response,"$.items[0].excerptMatchEnd")).intValue();
        assertTrue(excerpt.substring(excerptStart,excerptEnd).equalsIgnoreCase("искомое"));
        assertTrue(excerpt.length()<=202);
        assertFalse(Character.isLowSurrogate(excerpt.charAt(0)));
        assertFalse(Character.isHighSurrogate(excerpt.charAt(excerpt.length()-1)));
        mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","искомое").param("offset","0").param("limit","2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(3)).andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].index").value(0)).andExpect(jsonPath("$.items[1].index").value(1));
        mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","искомое").param("offset","99"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(3)).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(get("/api/books/"+id+"/search").session(other).param("q","искомое"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","x"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","искомое").param("offset","-1"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/books/"+id+"/search").session(session).param("q","искомое").param("limit","101"))
                .andExpect(status().isBadRequest());
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void epubSectionReturnsResolvedInternalLinks() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        byte[] bytes=afoni.projectf.service.BookTextExtractorTests.epub(afoni.projectf.service.BookTextExtractorTests.linkedEntries());
        var file=new org.springframework.mock.web.MockMultipartFile("file","links.epub","application/epub+zip",bytes);
        var uploaded=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        String id=JsonPath.read(uploaded.getResponse().getContentAsString(),"$.id");
        mvc.perform(get("/api/books/"+id+"/sections/0").session(other)).andExpect(status().isNotFound());
        mvc.perform(get("/api/books/"+id+"/sections/0").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.links.length()").value(4))
                .andExpect(jsonPath("$.links[0].targetSectionNumber").value(0))
                .andExpect(jsonPath("$.links[1].targetSectionNumber").value(1))
                .andExpect(jsonPath("$.links[1].targetSectionOffset").value(0))
                .andExpect(jsonPath("$.links[2].targetSectionNumber").value(1))
                .andExpect(jsonPath("$.links[2].targetSectionOffset").isNumber())
                .andExpect(jsonPath("$.links[3].kind").value("note"));
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM reader_section_links WHERE document_id=?",Integer.class,UUID.fromString(id)));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void bookDetailsExposeEpubMetadataAndOnlyOwnerCanEdit() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        var entries=afoni.projectf.service.BookTextExtractorTests.entries();
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf' xmlns:dc='http://purl.org/dc/elements/1.1/'><metadata><dc:title>Исходное название</dc:title><dc:creator>Исходный автор</dc:creator><dc:subject>Классика</dc:subject><dc:publisher>Первое издательство</dc:publisher><dc:date>1866</dc:date><dc:language>ru</dc:language><dc:description>Описание из OPF</dc:description></metadata><manifest><item id='cover' href='cover.jpg' media-type='image/jpeg' properties='cover-image'/><item id='one' href='chapters/one%20chapter.xhtml' media-type='application/xhtml+xml'/><item id='two' href='chapters/two.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='one'/><itemref idref='two'/></spine></package>");
        entries.put("OPS/cover.jpg","cover");
        byte[] bytes=afoni.projectf.service.BookTextExtractorTests.epub(entries);
        var file=new org.springframework.mock.web.MockMultipartFile("file","metadata.epub","application/epub+zip",bytes);
        var uploaded=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        String id=JsonPath.read(uploaded.getResponse().getContentAsString(),"$.id");
        mvc.perform(get("/api/books/"+id+"/details").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Исходное название"))
                .andExpect(jsonPath("$.author").value("Исходный автор"))
                .andExpect(jsonPath("$.publisher").value("Первое издательство"))
                .andExpect(jsonPath("$.publicationDate").value("1866"))
                .andExpect(jsonPath("$.language").value("ru"))
                .andExpect(jsonPath("$.description").value("Описание из OPF"))
                .andExpect(jsonPath("$.format").value("epub"))
                .andExpect(jsonPath("$.filename").value("metadata.epub"))
                .andExpect(jsonPath("$.fileSizeBytes").value(bytes.length))
                .andExpect(jsonPath("$.hasCover").value(true))
                .andExpect(jsonPath("$.createdAt").isNotEmpty()).andExpect(jsonPath("$.updatedAt").isNotEmpty());
        mvc.perform(get("/api/books/"+id+"/details").session(other)).andExpect(status().isNotFound());

        String update=new tools.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of(
                "title","Новое название","author","Новый автор","publisher","Новое издательство",
                "publicationDate","2024-10","language","en","genres",java.util.List.of("Роман","Драма","роман"),
                "description","Новое описание"));
        mvc.perform(put("/api/books/"+id+"/details").session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/books/"+id+"/details").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Новое название"))
                .andExpect(jsonPath("$.publicationDate").value("2024-10"))
                .andExpect(jsonPath("$.genres.length()").value(2))
                .andExpect(jsonPath("$.genres[0]").value("Драма")).andExpect(jsonPath("$.genres[1]").value("Роман"));
        mvc.perform(get("/api/books/"+id+"/details").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.publisher").value("Новое издательство"))
                .andExpect(jsonPath("$.language").value("en")).andExpect(jsonPath("$.description").value("Новое описание"));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void fb2DetailsRefreshOnlyFoundExtendedMetadataAndRequiresOwner() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String xml="<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><genre>fiction</genre><book-title>Название из файла</book-title><author><first-name>Автор</first-name><last-name>Файла</last-name></author><annotation><p>Первый   абзац.</p><p>Второй абзац.</p></annotation><date value='2007-01-01'>2007</date><lang>ru</lang></title-info><publish-info><publisher>Издательство АСТ</publisher><year>2018</year></publish-info></description><body><section><title><p>Глава</p></title><p>Текст книги.</p></section></body></FictionBook>";
        byte[] bytes=xml.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var file=new org.springframework.mock.web.MockMultipartFile("file","refresh.fb2","application/xml",bytes);
        var uploaded=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf()))
                .andExpect(status().isAccepted()).andReturn();
        UUID id=UUID.fromString(JsonPath.read(uploaded.getResponse().getContentAsString(),"$.id"));
        jdbc.update("UPDATE documents SET title='Ручное название',author='Ручной автор',publisher=NULL,publication_date=NULL,language=NULL,description=NULL,library_status='reading' WHERE id=?",id);
        jdbc.update("DELETE FROM book_genres WHERE document_id=?",id);
        jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,'Ручной жанр')",id);
        mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":1}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/books/"+id+"/bookmarks").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":1,\"excerpt\":\"Текст\"}"))
                .andExpect(status().isCreated());
        int sections=jdbc.queryForObject("SELECT count(*) FROM reader_sections WHERE document_id=?",Integer.class,id);

        mvc.perform(post("/api/books/"+id+"/details/refresh").session(other).with(csrf()))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/books/"+id+"/details/refresh").session(session).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Ручное название"))
                .andExpect(jsonPath("$.author").value("Ручной автор"))
                .andExpect(jsonPath("$.genres[0]").value("Ручной жанр"))
                .andExpect(jsonPath("$.publisher").value("Издательство АСТ"))
                .andExpect(jsonPath("$.publicationDate").value("2007-01-01"))
                .andExpect(jsonPath("$.language").value("ru"))
                .andExpect(jsonPath("$.description").value("Первый абзац.\n\nВторой абзац."));
        assertEquals("reading",jdbc.queryForObject("SELECT library_status FROM documents WHERE id=?",String.class,id));
        assertEquals(sections,jdbc.queryForObject("SELECT count(*) FROM reader_sections WHERE document_id=?",Integer.class,id));
        assertEquals(1,jdbc.queryForObject("SELECT position_offset FROM reading_progress WHERE document_id=?",Integer.class,id));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM reader_bookmarks WHERE document_id=?",Integer.class,id));

        jdbc.update("UPDATE documents SET original_file=NULL WHERE id=?",id);
        mvc.perform(post("/api/books/"+id+"/details/refresh").session(session).with(csrf()))
                .andExpect(status().isConflict());
        assertEquals("Издательство АСТ",jdbc.queryForObject("SELECT publisher FROM documents WHERE id=?",String.class,id));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void libraryMetadataSearchStatusAndReadingTimeRoundTrip() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Братья Карамазовы\",\"content\":\"Большой роман для чтения\"}"))
                .andExpect(status().isCreated());
        UUID id=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        jdbc.update("UPDATE documents SET material_type='BOOK' WHERE id=?",id);
        mvc.perform(put("/api/books/"+id+"/library").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"reading\",\"author\":\"Фёдор Достоевский\",\"genres\":[\"Роман\",\"Классика\"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.genres[0]").value("Роман"));
        mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":5,\"elapsedSeconds\":60}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.readingSeconds").value(60))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.lastReadAt").isNotEmpty());
        mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":8,\"version\":0}"))
                .andExpect(status().isConflict());
        mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":8,\"version\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.positionOffset").value(8))
                .andExpect(jsonPath("$.version").value(2));
        mvc.perform(get("/api/books?q=достоевский&status=reading&sort=duration").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].author").value("Фёдор Достоевский"))
                .andExpect(jsonPath("$.items[0].genres[1]").value("Роман"))
                .andExpect(jsonPath("$.items[0].libraryStatus").value("reading"))
                .andExpect(jsonPath("$.items[0].readingSeconds").value(60));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void annotationsCanBeEditedExportedAndSpanSectionBoundary() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String text="Первая глава\n\nВторая глава";
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Книга заметок\",\"content\":\"Первая глава\\n\\nВторая глава\"}"))
                .andExpect(status().isCreated());
        UUID id=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        jdbc.update("INSERT INTO reader_sections(document_id,section_number,title,role,start_offset,end_offset,content,toc_level) VALUES (?,?,?,?,?,?,?,?)",
                id,0,"Первая","main",0,12,text.substring(0,12),0);
        jdbc.update("INSERT INTO reader_sections(document_id,section_number,title,role,start_offset,end_offset,content,toc_level) VALUES (?,?,?,?,?,?,?,?)",
                id,1,"Вторая","main",12,text.length(),text.substring(12),0);

        var bookmarkResult=mvc.perform(post("/api/books/"+id+"/bookmarks").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":2,\"label\":\"Начало\",\"excerpt\":\"Первая глава\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.updatedAt").isNotEmpty()).andReturn();
        String bookmarkId=JsonPath.read(bookmarkResult.getResponse().getContentAsString(),"$.id");
        mvc.perform(put("/api/books/"+id+"/bookmarks/"+bookmarkId).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"Важное начало\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.label").value("Важное начало"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        int start=9,end=16;
        String exact=text.substring(start,end);
        var highlightResult=mvc.perform(post("/api/books/"+id+"/highlights").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startOffset\":"+start+",\"endOffset\":"+end+",\"color\":\"yellow\",\"note\":\"Через разделы\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.exactText").value(exact)).andReturn();
        mvc.perform(post("/api/books/"+id+"/highlights").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startOffset\":"+start+",\"endOffset\":"+end+",\"color\":\"green\"}"))
                .andExpect(status().isConflict());
        String highlightId=JsonPath.read(highlightResult.getResponse().getContentAsString(),"$.id");
        mvc.perform(put("/api/books/"+id+"/highlights/"+highlightId).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"color\":\"blue\",\"note\":\"Исправленная заметка\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.color").value("blue"))
                .andExpect(jsonPath("$.note").value("Исправленная заметка"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());
        mvc.perform(put("/api/books/"+id+"/highlights/"+highlightId).session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"color\":\"pink\"}"))
                .andExpect(status().isNotFound());

        var export=mvc.perform(get("/api/books/"+id+"/annotations/export").session(session))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("text/markdown"))
                .andExpect(header().string("Content-Disposition",org.hamcrest.Matchers.containsString("attachment"))).andReturn();
        String markdown=export.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(markdown.contains("# Книга заметок — заметки и цитаты"));
        assertTrue(markdown.contains("### Важное начало"));
        assertTrue(markdown.contains("Исправленная заметка"));
        assertTrue(markdown.contains(exact.replace("\n","\n> ")));
        mvc.perform(get("/api/books/"+id+"/annotations/export").session(other)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void libraryManagementFiltersCoversFavoritesBulkStatusAndDownloads() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Альфа\",\"content\":\"Первая книга\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Бета\",\"content\":\"Вторая книга длиннее\"}"))
                .andExpect(status().isCreated());
        UUID first=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=? AND d.title='Альфа'",UUID.class,email);
        UUID second=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=? AND d.title='Бета'",UUID.class,email);
        jdbc.update("UPDATE documents SET source_type='txt',author='Анна',original_size=100,material_type='BOOK' WHERE id=?",first);
        jdbc.update("UPDATE documents SET source_type='fb2',author='Яков',original_size=200,material_type='BOOK' WHERE id=?",second);
        jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,'Роман'),(?,'Драма')",second,first);

        mvc.perform(put("/api/books/"+second+"/favorite").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":true}"))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/books/"+second+"/favorite").session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":false}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/books?format=fb2&genre=Роман&favorite=yes&sort=size&direction=desc").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(second.toString()))
                .andExpect(jsonPath("$.items[0].favorite").value(true))
                .andExpect(jsonPath("$.items[0].fileSizeBytes").value(200));
        mvc.perform(get("/api/books?sort=author&direction=desc").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].author").value("Яков"));
        mvc.perform(get("/api/books/facets").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.formats.length()").value(2))
                .andExpect(jsonPath("$.genres.length()").value(2));

        mvc.perform(put("/api/books/bulk-status").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\""+first+"\",\""+second+"\"],\"status\":\"finished\"}"))
                .andExpect(status().isNoContent());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM documents WHERE id IN (?,?) AND library_status='finished'",Integer.class,first,second));
        mvc.perform(put("/api/books/bulk-status").session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\""+first+"\"],\"status\":\"reading\"}"))
                .andExpect(status().isNotFound());
        assertEquals("finished",jdbc.queryForObject("SELECT library_status FROM documents WHERE id=?",String.class,first));

        byte[] png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        var cover=new org.springframework.mock.web.MockMultipartFile("file","cover.png","image/png",png);
        mvc.perform(multipart("/api/books/"+second+"/cover").file(cover).session(session).with(csrf())
                        .with(request->{request.setMethod("PUT");return request;}))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasCover").value(true))
                .andExpect(jsonPath("$.favorite").value(true)).andExpect(jsonPath("$.assetCount").value(1))
                .andExpect(jsonPath("$.textLength").value("Вторая книга длиннее".length()))
                .andExpect(jsonPath("$.preparationStatus").value("not_started"));
        mvc.perform(get("/api/books/"+second+"/cover").session(session)).andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.IMAGE_PNG)).andExpect(content().bytes(png));
        var invalid=new org.springframework.mock.web.MockMultipartFile("file","cover.png","image/png",new byte[]{1,2,3});
        mvc.perform(multipart("/api/books/"+second+"/cover").file(invalid).session(session).with(csrf())
                        .with(request->{request.setMethod("PUT");return request;}))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/books/"+second+"/original?download=true").session(session))
                .andExpect(status().isOk()).andExpect(header().string("Content-Disposition",org.hamcrest.Matchers.containsString("attachment")))
                .andExpect(content().bytes("Вторая книга длиннее".getBytes(StandardCharsets.UTF_8)));
        mvc.perform(get("/api/books/"+second+"/original?download=true").session(other)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/documents/"+first).session(session).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(delete("/api/documents/"+second).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void bookCollectionsArePrivateFilterableAndKeepBooksWhenDeleted() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Книга для коллекции\",\"content\":\"Текст книги\"}"))
                .andExpect(status().isCreated());
        UUID book=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        jdbc.update("UPDATE documents SET material_type='BOOK' WHERE id=?",book);
        var created=mvc.perform(post("/api/books/collections").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"  Фантастика  \"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("Фантастика"))
                .andExpect(jsonPath("$.bookCount").value(0)).andReturn();
        String collection=JsonPath.read(created.getResponse().getContentAsString(),"$.id");
        mvc.perform(post("/api/books/collections").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"фантастика\"}"))
                .andExpect(status().isConflict());
        var foreign=mvc.perform(post("/api/books/collections").session(other).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Фантастика\"}"))
                .andExpect(status().isCreated()).andReturn();
        String foreignCollection=JsonPath.read(foreign.getResponse().getContentAsString(),"$.id");

        mvc.perform(put("/api/books/bulk-collection").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\""+book+"\"],\"collectionId\":\""+foreignCollection+"\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/books/bulk-collection").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\""+book+"\"],\"collectionId\":\""+collection+"\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/books?collection="+collection).session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].collectionId").value(collection));
        mvc.perform(get("/api/books/collections").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].bookCount").value(1));
        mvc.perform(put("/api/books/collections/"+collection).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Любимая фантастика\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Любимая фантастика"));
        mvc.perform(delete("/api/books/collections/"+collection).session(other).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(delete("/api/books/collections/"+collection).session(session).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/books?collection=none").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(book.toString()));

        mvc.perform(delete("/api/documents/"+book).session(session).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(delete("/api/books/collections/"+foreignCollection).session(other).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void readingSessionsStatisticsGoalsAndEstimateAreTrackedWithoutDuplicateTime() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        String text="к".repeat(5000);
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Статистика\",\"content\":\""+text+"\"}"))
                .andExpect(status().isCreated());
        UUID book=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        jdbc.update("UPDATE documents SET material_type='BOOK' WHERE id=?",book);
        jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,?)",book,"Классика");
        UUID readingSession=UUID.randomUUID();
        mvc.perform(put("/api/books/"+book+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":100,\"confirmedOffset\":100,\"elapsedSeconds\":60,\"sessionId\":\""+readingSession+"\",\"sessionElapsedSeconds\":60}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mvc.perform(put("/api/books/"+book+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":500,\"confirmedOffset\":500,\"version\":1,\"elapsedSeconds\":60,\"sessionId\":\""+readingSession+"\",\"sessionElapsedSeconds\":120}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.readingSeconds").value(120));
        mvc.perform(put("/api/books/"+book+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":500,\"confirmedOffset\":500,\"version\":2,\"elapsedSeconds\":60,\"sessionId\":\""+readingSession+"\",\"sessionElapsedSeconds\":120}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.readingSeconds").value(120));

        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE id=?",Integer.class,readingSession));
        assertEquals(120,jdbc.queryForObject("SELECT duration_seconds FROM reading_sessions WHERE id=?",Integer.class,readingSession));
        assertEquals(500L,jdbc.queryForObject("SELECT characters_read FROM reading_sessions WHERE id=?",Long.class,readingSession));
        mvc.perform(get("/api/reading/statistics").session(session).param("timezone","Europe/Moscow"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.day.durationSeconds").value(120))
                .andExpect(jsonPath("$.day.charactersRead").value(500)).andExpect(jsonPath("$.day.approximatePages").value(1))
                .andExpect(jsonPath("$.day.averageCharactersPerMinute").value(250))
                .andExpect(jsonPath("$.week.durationSeconds").value(120)).andExpect(jsonPath("$.month.durationSeconds").value(120))
                .andExpect(jsonPath("$.activity.length()").value(365)).andExpect(jsonPath("$.currentBook.id").value(book.toString()))
                .andExpect(jsonPath("$.currentBook.progressPercent").value(10)).andExpect(jsonPath("$.currentBook.remainingSeconds").value(1080))
                .andExpect(jsonPath("$.goal.dailyMinutes").value(20)).andExpect(jsonPath("$.goal.monthlyBooks").value(2))
                .andExpect(jsonPath("$.genres[0].genre").value("Классика")).andExpect(jsonPath("$.genres[0].books").value(1));
        mvc.perform(get("/api/reading/statistics").session(other).param("timezone","Europe/Moscow"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.day.durationSeconds").value(0)).andExpect(jsonPath("$.currentBook").doesNotExist());
        mvc.perform(get("/api/reading/statistics").session(session).param("timezone","Mars/Olympus"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/reading/goal").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyMinutes\":35,\"monthlyBooks\":4}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.dailyMinutes").value(35)).andExpect(jsonPath("$.monthlyBooks").value(4));
        mvc.perform(put("/api/reading/goal").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyMinutes\":1441,\"monthlyBooks\":4}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/reading/statistics").session(session).param("timezone","Europe/Moscow"))
                .andExpect(jsonPath("$.goal.dailyMinutes").value(35)).andExpect(jsonPath("$.goal.monthlyBooks").value(4));
        mvc.perform(delete("/api/documents/"+book).session(session).with(csrf())).andExpect(status().isNoContent());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE id=?",Integer.class,readingSession));
    }

    @Test
    void rejectsInvalidTxtUploads() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        for (var file : java.util.List.of(
                new org.springframework.mock.web.MockMultipartFile("file","book.pdf","text/plain",new byte[]{65}),
                new org.springframework.mock.web.MockMultipartFile("file","book.txt","text/plain",new byte[]{(byte)0xC3,0x28}),
                new org.springframework.mock.web.MockMultipartFile("file","book.txt","text/plain",new byte[]{0}),
                new org.springframework.mock.web.MockMultipartFile("file","book.txt","text/plain",new byte[0]))) {
            mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf())).andExpect(status().isBadRequest());
        }
        var large=new org.springframework.mock.web.MockMultipartFile("file","book.txt","text/plain",new byte[30*1024*1024+1]);
        mvc.perform(multipart("/api/documents/upload").file(large).session(session).with(csrf())).andExpect(status().isPayloadTooLarge());
    }

    @Test
    void resumableUploadCompletesIdempotentlyThroughBackgroundImport() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        byte[] bytes="Первая глава\n\nТекст книги".getBytes(StandardCharsets.UTF_8);
        String hash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        var started=mvc.perform(post("/api/book-uploads").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"filename\":\"book.txt\",\"title\":\"book\",\"size\":"+bytes.length+",\"materialType\":\"BOOK\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("uploading")).andReturn();
        String uploadId=JsonPath.read(started.getResponse().getContentAsString(),"$.id");
        mvc.perform(patch("/api/book-uploads/"+uploadId).session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_OCTET_STREAM).header("Upload-Offset",0).content(bytes))
                .andExpect(status().isOk()).andExpect(jsonPath("$.confirmedOffset").value(bytes.length));
        String completeBody="{\"sha256\":\""+hash+"\"}";
        mvc.perform(post("/api/book-uploads/"+uploadId+"/complete").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"sha256\":\""+"0".repeat(64)+"\"}"))
                .andExpect(status().isBadRequest());
        for(int attempt=0;attempt<2;attempt++) mvc.perform(post("/api/book-uploads/"+uploadId+"/complete")
                        .session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(completeBody))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("queued"))
                .andExpect(jsonPath("$.documentId").doesNotExist());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM documents d JOIN book_upload_sessions u ON u.user_id=d.user_id WHERE u.id=?",Integer.class,UUID.fromString(uploadId)));
        bookImports.processNext();
        var completed=mvc.perform(get("/api/book-uploads/"+uploadId).session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("completed"))
                .andExpect(jsonPath("$.importProgress").value(100)).andExpect(jsonPath("$.report.importedSections").value(1))
                .andReturn();
        String documentId=JsonPath.read(completed.getResponse().getContentAsString(),"$.documentId");
        mvc.perform(post("/api/book-uploads/"+uploadId+"/complete").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(completeBody))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.documentId").value(documentId));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM documents WHERE id=?",Integer.class,UUID.fromString(documentId)));
        mvc.perform(delete("/api/documents/"+documentId).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void failedBackgroundImportCanBeRetriedWithoutUploadingAgain() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        byte[] bytes="not a pdf".getBytes(StandardCharsets.UTF_8);
        String hash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        var started=mvc.perform(post("/api/book-uploads").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"filename\":\"broken.pdf\",\"title\":\"broken\",\"size\":"+bytes.length+",\"materialType\":\"DOCUMENT\"}"))
                .andExpect(status().isCreated()).andReturn();
        String uploadId=JsonPath.read(started.getResponse().getContentAsString(),"$.id");
        mvc.perform(patch("/api/book-uploads/"+uploadId).session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_OCTET_STREAM).header("Upload-Offset",0).content(bytes))
                .andExpect(status().isOk());
        mvc.perform(post("/api/book-uploads/"+uploadId+"/complete").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"sha256\":\""+hash+"\"}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("queued"));
        bookImports.processNext();
        mvc.perform(get("/api/book-uploads/"+uploadId).session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("failed"))
                .andExpect(jsonPath("$.errorMessage").isNotEmpty());
        mvc.perform(post("/api/book-uploads/"+uploadId+"/retry").session(session).with(csrf()))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("queued"));
        assertEquals(bytes.length,jdbc.queryForObject("SELECT octet_length(uploaded_bytes) FROM book_upload_sessions WHERE id=?",Integer.class,UUID.fromString(uploadId)));
        jdbc.update("DELETE FROM book_upload_sessions WHERE id=?",UUID.fromString(uploadId));
    }

    private MockHttpSession registerAccount(String email, String pass) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/auth/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.email").value(email.toLowerCase()))
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andReturn().getRequest().getSession(false);
    }

    @Test
    void browserCsrfFlowRotatesTokenAfterAuthentication() throws Exception {
        var initial = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) initial.getRequest().getSession(false);
        String oldToken = JsonPath.read(initial.getResponse().getContentAsString(), "$.token");
        String email = UUID.randomUUID() + "@example.test";
        String pass = UUID.randomUUID().toString();
        mvc.perform(post("/api/auth/register").session(session).header("X-CSRF-TOKEN", oldToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/documents").session(session).header("X-CSRF-TOKEN", oldToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Title\",\"content\":\"Content\"}"))
                .andExpect(status().isForbidden());
        var refreshed = mvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk()).andReturn();
        String token = JsonPath.read(refreshed.getResponse().getContentAsString(), "$.token");
        mvc.perform(post("/api/documents").session(session).header("X-CSRF-TOKEN", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Title\",\"content\":\"Content\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/auth/logout").session(session).header("X-CSRF-TOKEN", token))
                .andExpect(status().isNoContent());
    }

    @Test
    void registrationLoginCsrfAndLogout() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        String pass = UUID.randomUUID().toString();
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/documents")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.headerName").value("X-CSRF-TOKEN"));
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"invalid\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        var session = registerAccount(email, pass);
        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.documentCount").value(0));
        String storedHash = jdbc.queryForObject("SELECT password_hash FROM users WHERE email = ?", String.class, email);
        assertFalse(pass.equals(storedHash));
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email.toUpperCase() + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"wrong-password-value\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").session(session)).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").session(session).with(csrf())).andExpect(status().isNoContent());
        assertTrue(session.isInvalid());
        var anonymous = new MockHttpSession();
        String previousId = anonymous.getId();
        var loggedIn = (MockHttpSession) mvc.perform(post("/api/auth/login").session(anonymous).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email.toUpperCase() + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        assertFalse(previousId.equals(loggedIn.getId()));
        mvc.perform(get("/api/auth/me").session(loggedIn)).andExpect(status().isOk());
    }

    @Test
    void rememberMeRestoresAfterSessionExpiresAndLogoutRevokesIt() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        String pass = UUID.randomUUID().toString();
        registerAccount(email, pass);
        var login = mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + pass + "\",\"rememberMe\":true}"))
                .andExpect(status().isOk()).andReturn();
        String cookieHeader = login.getResponse().getHeaders("Set-Cookie").stream()
                .filter(value -> value.startsWith("PROJECTF_REMEMBER="))
                .findFirst().orElseThrow();
        assertTrue(cookieHeader.contains("HttpOnly"));
        assertTrue(cookieHeader.contains("SameSite=Lax"));
        assertTrue(cookieHeader.contains("Max-Age=2592000"));
        String value = cookieHeader.substring("PROJECTF_REMEMBER=".length()).split(";", 2)[0];
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM remembered_logins WHERE user_id=(SELECT id FROM users WHERE email=?)",
                Integer.class, email));
        assertFalse(jdbc.queryForObject("SELECT token_hash FROM remembered_logins WHERE user_id=(SELECT id FROM users WHERE email=?)",
                String.class, email).contains(value.split("\\.", 2)[1]));

        Cookie remembered = new Cookie("PROJECTF_REMEMBER", value);
        var restored = mvc.perform(get("/api/auth/csrf").cookie(remembered))
                .andExpect(status().isOk()).andReturn();
        var restoredSession = (MockHttpSession) restored.getRequest().getSession(false);
        assertNotNull(restoredSession);
        mvc.perform(get("/api/auth/me").session(restoredSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$.email").value(email));
        String csrfToken = JsonPath.read(restored.getResponse().getContentAsString(), "$.token");
        mvc.perform(post("/api/auth/logout").session(restoredSession).cookie(remembered)
                        .header("X-CSRF-TOKEN", csrfToken))
                .andExpect(status().isNoContent());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM remembered_logins WHERE user_id=(SELECT id FROM users WHERE email=?)",
                Integer.class, email));
        mvc.perform(get("/api/auth/me").cookie(remembered)).andExpect(status().isUnauthorized());
    }

    @Test
    void sessionRevocationAlsoRevokesRememberedLogin() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        String pass = UUID.randomUUID().toString();
        registerAccount(email, pass);
        var login = mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + pass + "\",\"rememberMe\":true}"))
                .andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) login.getRequest().getSession(false);
        String id = session.getId();
        String cookieHeader = login.getResponse().getHeaders("Set-Cookie").stream()
                .filter(value -> value.startsWith("PROJECTF_REMEMBER="))
                .findFirst().orElseThrow();
        Cookie cookie = new Cookie("PROJECTF_REMEMBER",
                cookieHeader.substring("PROJECTF_REMEMBER=".length()).split(";", 2)[0]);
        mvc.perform(delete("/api/auth/sessions/" + id).session(session).cookie(cookie).with(csrf()))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized());
    }

    @Test
    void profileDetailsAndAvatarCanBeUpdated() throws Exception {
        var session = registerAccount(UUID.randomUUID() + "@example.test", UUID.randomUUID().toString());
        mvc.perform(put("/api/auth/profile").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"  Читатель  \" ,\"bio\":\" Люблю большие романы. \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Читатель"))
                .andExpect(jsonPath("$.bio").value("Люблю большие романы."))
                .andExpect(jsonPath("$.hasAvatar").value(false));

        byte[] png = new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
        var avatar = new org.springframework.mock.web.MockMultipartFile("file", "avatar.png", "image/png", png);
        mvc.perform(multipart("/api/auth/profile/avatar").file(avatar).session(session).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasAvatar").value(true));
        mvc.perform(get("/api/auth/profile/avatar").session(session))
                .andExpect(status().isOk()).andExpect(content().contentType("image/png"))
                .andExpect(content().bytes(png));

        var invalid = new org.springframework.mock.web.MockMultipartFile("file", "avatar.png", "image/png", new byte[]{1, 2, 3});
        mvc.perform(multipart("/api/auth/profile/avatar").file(invalid).session(session).with(csrf()))
                .andExpect(status().isBadRequest());
        mvc.perform(delete("/api/auth/profile/avatar").session(session).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasAvatar").value(false));
        mvc.perform(get("/api/auth/profile/avatar").session(session)).andExpect(status().isNotFound());
    }

    @Test
    void userCanInspectAndRevokeAnotherSession() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        String pass = UUID.randomUUID().toString();
        var first = registerAccount(email, pass);
        mvc.perform(get("/api/auth/me").session(first)
                        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0"))
                .andExpect(status().isOk());

        var secondResult = mvc.perform(post("/api/auth/login").with(csrf())
                        .header("User-Agent", "Mozilla/5.0 (Android 16; Mobile) Firefox/142.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isOk()).andReturn();
        var second = (MockHttpSession) secondResult.getRequest().getSession(false);

        var list = mvc.perform(get("/api/auth/sessions").session(first))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].current").value(true))
                .andExpect(jsonPath("$[1].current").value(false))
                .andReturn();
        java.util.List<String> otherIds = JsonPath.read(list.getResponse().getContentAsString(), "$[?(@.current == false)].id");
        assertEquals(1, otherIds.size());

        mvc.perform(delete("/api/auth/sessions/" + otherIds.getFirst()).session(first).with(csrf()))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").session(second)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").session(first)).andExpect(status().isOk());
    }

    @Test
    void documentsArePrivateAndLegacyApiIsClosed() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var alice = registerAccount(email, UUID.randomUUID().toString());
        var bob = registerAccount(UUID.randomUUID() + "@example.test", UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(alice).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Private\",\"content\":\"" + "Текст ".repeat(1000) + "\"}"))
                .andExpect(status().isCreated());
        UUID id = jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON d.user_id = u.id WHERE u.email = ?", UUID.class, email);
        mvc.perform(get("/api/documents").session(alice)).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/documents").session(bob)).andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(get("/api/documents/" + id).session(bob)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/documents/" + id).session(bob).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(get("/api/documents/" + id).session(alice)).andExpect(status().isOk());
        mvc.perform(get("/api/notes").session(alice)).andExpect(status().isForbidden());
        mvc.perform(get("/api/documents?page=-1").session(alice)).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/documents/" + id).session(alice).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/documents/" + id).session(alice)).andExpect(status().isNotFound());
    }

    @Test
    void documentSearchAndFiltersWorkAcrossList() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var session = registerAccount(email, UUID.randomUUID().toString());
        for (String title : java.util.List.of("Alpha", "Zeta")) {
            mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\"" + title + "\",\"content\":\"Sample text\"}"))
                    .andExpect(status().isCreated());
        }
        jdbc.update("UPDATE documents SET source_type='pdf', original_filename='Report.pdf', original_size=100 WHERE title='Alpha' AND user_id=(SELECT id FROM users WHERE email=?)", email);
        jdbc.update("UPDATE documents SET source_type='docx', original_filename='Notes.docx', original_size=200 WHERE title='Zeta' AND user_id=(SELECT id FROM users WHERE email=?)", email);

        mvc.perform(get("/api/documents?q=report&format=pdf").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value("Alpha"));
        mvc.perform(get("/api/documents?q=REPORT").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/documents?q=%25").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/documents?q=report&format=docx").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/documents?sort=size&direction=desc").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].title").value("Zeta"));
        mvc.perform(get("/api/documents?sort=title&direction=asc").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].title").value("Alpha"));
        mvc.perform(get("/api/documents?sort=invalid").session(session)).andExpect(status().isBadRequest());
    }

    @Test
    void migrationsAreAppliedOnceAndLongNotesRoundTrip() {
        assertEquals(28, flyway.info().applied().length);
        assertEquals(0, flyway.migrate().migrationsExecuted);
        Note note = new Note();
        note.setTitle("Migration test");
        note.setContent("Большой текст. ".repeat(10000));
        Note saved = notes.saveNote(note);
        assertEquals(note.getContent(), notes.getNoteById(saved.getId()).getContent());
        notes.deleteNoteById(saved.getId());
    }

    @Test
    void schemaEnforcesOwnershipEmailAndCompressionConstraints() {
        UUID user = UUID.randomUUID();
        String email = user + "@example.test";
        jdbc.update("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                user, email, "synthetic-test-hash");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                " " + email.toUpperCase() + " ", "synthetic-test-hash"));

        UUID document = UUID.randomUUID();
        String original = "Исходный материал. ".repeat(10000);
        jdbc.update("INSERT INTO documents (id, user_id, title, original_text) VALUES (?, ?, ?, ?)",
                document, user, "Document", original);
        assertEquals(original, jdbc.queryForObject("SELECT original_text FROM documents WHERE id = ?", String.class, document));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "INSERT INTO documents (user_id, title, original_text) VALUES (?, 'Title', 'Text')", UUID.randomUUID()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "INSERT INTO summaries (document_id, summary_text, compression_level, compression_percent, algorithm) VALUES (?, 'Summary', 'short', 0, 'extractive-v1')", document));
        for (int percent : new int[]{20, 35}) {
            jdbc.update("INSERT INTO summaries (document_id, summary_text, compression_level, compression_percent, algorithm) VALUES (?, 'Summary', 'short', ?, 'extractive-v1')", document, percent);
        }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM summaries WHERE document_id = ?", Integer.class, document));
        jdbc.update("DELETE FROM users WHERE id = ?", user);
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM documents WHERE id = ?", Integer.class, document));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM summaries WHERE document_id = ?", Integer.class, document));
    }

    @Test
    void explicitBaselineAtZeroPreservesLegacyNotes() throws Exception {
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
             var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA legacy_test");
            statement.execute("CREATE TABLE legacy_test.note (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title VARCHAR(255), content VARCHAR(255), created_at TIMESTAMP, updated_at TIMESTAMP)");
            statement.execute("INSERT INTO legacy_test.note (title, content) VALUES ('Existing', 'Keep this record')");
        }
        Flyway legacy = Flyway.configure()
                .dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
                .schemas("legacy_test").defaultSchema("legacy_test")
                .locations("classpath:db/migration").baselineVersion("0").load();
        // Explicit adoption is tested; normal startup never baselines automatically.
        legacy.baseline();
        assertEquals(28, legacy.migrate().migrationsExecuted);
        assertEquals("Keep this record", jdbc.queryForObject("SELECT content FROM legacy_test.note WHERE id = 1", String.class));
        assertEquals("text", jdbc.queryForObject("SELECT data_type FROM information_schema.columns WHERE table_schema = 'legacy_test' AND table_name = 'note' AND column_name = 'content'", String.class));
    }
}

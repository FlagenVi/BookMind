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
import java.util.UUID;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import com.jayway.jsonpath.JsonPath;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
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
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @org.springframework.test.context.bean.override.mockito.MockitoBean
    afoni.projectf.service.LlmSettings llmSettings;

    @Test
    void summaryQueueRetriesAndReducesWithoutRepeatingCompletedSteps() throws Exception {
        org.mockito.Mockito.when(llmSettings.configured()).thenReturn(true);
        org.mockito.Mockito.when(llmSettings.model()).thenReturn("openai/gpt-oss-120b");
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        var other=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Test\",\"content\":\""+"Русский текст 📚. ".repeat(1000)+"\"}")).andExpect(status().isCreated());
        UUID document=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        String path="/api/documents/"+document+"/summary";
        mvc.perform(post(path).session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"level\":\"medium\"}")).andExpect(status().isBadRequest());
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
            assertTrue(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=afoni.projectf.service.SummaryQueue.INPUT_BYTES);
            if(calls.incrementAndGet()==1) throw new afoni.projectf.service.Summarizer.Failure("Квота",true,70);
            return new afoni.projectf.service.Summarizer.Result("Краткое изложение.",50);
        };
        var worker=new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake);
        worker.tick();
        mvc.perform(get(path).session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("waiting"));
        worker.tick(); assertEquals(1,calls.get());
        for(int i=0;i<40;i++) {
            jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
            jdbc.update("UPDATE summary_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE document_id=?",document);
            new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).tick();
        }
        mvc.perform(get(path).session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready")).andExpect(jsonPath("$.text").value("Краткое изложение."));
        mvc.perform(get(path).session(session)).andExpect(jsonPath("$.sections[0].text").value("Краткое изложение."));
        mvc.perform(get(path+"/sections/0").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$[0].text").value("Краткое изложение."));
        long steps=jdbc.queryForObject("SELECT count(*) FROM summary_steps s JOIN summary_jobs j ON j.id=s.job_id WHERE j.document_id=?",Long.class,document);
        assertEquals(steps+1,calls.get());
        assertEquals(steps*50,jdbc.queryForObject("SELECT tokens_used FROM summary_jobs WHERE document_id=?",Long.class,document));
        assertTrue(jdbc.queryForObject("SELECT round_number FROM summary_jobs WHERE document_id=?",Integer.class,document)>0);
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

    @Test void chapterBoundariesRepairAndAncillaryExclusionSurviveRestart() throws Exception {
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
            if(mode.startsWith("repair_")) {assertEquals("Черновик Альфа",text);return new afoni.projectf.service.Summarizer.Result("Альфа",10,1);}
            if(mode.startsWith("overview_")) { assertFalse(text.contains("Сноска"));assertTrue(text.contains("Первый рассказ"));assertTrue(text.contains("Второй рассказ"));return new afoni.projectf.service.Summarizer.Result("Обзор",10,1); }
            assertFalse(text.contains("Альфа") && text.contains("Бета"));
            return new afoni.projectf.service.Summarizer.Result(text.contains("Сноска")?"Сноска":text.contains("Бета")?"Бета":"Альфа",10,1);
        };
        new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).initialize(job,doc);
        for(int i=0;i<30;i++) {
            jdbc.update("UPDATE llm_throttle SET next_call_at=CURRENT_TIMESTAMP");
            jdbc.update("UPDATE summary_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=?",job);
            new afoni.projectf.service.SummaryQueue(jdbc,transactionManager,fake).tick();
        }
        assertEquals("ready",jdbc.queryForObject("SELECT status FROM summary_jobs WHERE id=?",String.class,job));
        assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM summary_sections WHERE job_id=? AND summary_text IS NOT NULL",Integer.class,job));
        assertEquals(123+(calls.get()-1)*10,jdbc.queryForObject("SELECT tokens_used FROM summary_jobs WHERE id=?",Integer.class,job));
        mvc.perform(delete("/api/documents/"+doc).session(session).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void ebookUploadsAreStoredAndPrepared() throws Exception {
        var session=registerAccount(UUID.randomUUID()+"@example.test",UUID.randomUUID().toString());
        for(String format:java.util.List.of("epub","fb2")) {
            byte[] bytes=format.equals("fb2") ? afoni.projectf.service.BookTextExtractorTests.fb2() : afoni.projectf.service.BookTextExtractorTests.epub(afoni.projectf.service.BookTextExtractorTests.entries());
            var file=new org.springframework.mock.web.MockMultipartFile("file","book."+format.toUpperCase(java.util.Locale.ROOT),"application/octet-stream",bytes);
            var result=mvc.perform(multipart("/api/documents/upload").file(file).session(session).with(csrf())).andExpect(status().isAccepted()).andReturn();
            UUID id=UUID.fromString(JsonPath.read(result.getResponse().getContentAsString(),"$.id"));
            assertEquals(format,jdbc.queryForObject("SELECT source_type FROM documents WHERE id=?",String.class,id));
            String text=jdbc.queryForObject("SELECT original_text FROM documents WHERE id=?",String.class,id);
            assertTrue(text.contains("Привет мир!"));
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM reader_sections WHERE document_id=?",Integer.class,id)>0);
            mvc.perform(get("/api/books/"+id+"/manifest").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.sections[0].role").value("main"));
            mvc.perform(get("/api/books/"+id+"/sections/0").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.content").isNotEmpty());
            mvc.perform(get("/api/books/"+id+"/content").session(session))
                    .andExpect(status().isOk()).andExpect(jsonPath("$[0].content").isNotEmpty());
            for(int i=0;i<10;i++) preparation.processNext();
            assertEquals(text,jdbc.queryForObject("SELECT string_agg(content,'' ORDER BY part_number) FROM document_parts WHERE document_id=?",String.class,id));
            mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
        }
    }

    @Test
    void libraryMetadataSearchStatusAndReadingTimeRoundTrip() throws Exception {
        String email=UUID.randomUUID()+"@example.test";
        var session=registerAccount(email,UUID.randomUUID().toString());
        mvc.perform(post("/api/documents").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Братья Карамазовы\",\"content\":\"Большой роман для чтения\"}"))
                .andExpect(status().isCreated());
        UUID id=jdbc.queryForObject("SELECT d.id FROM documents d JOIN users u ON u.id=d.user_id WHERE u.email=?",UUID.class,email);
        mvc.perform(put("/api/books/"+id+"/library").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"reading\",\"author\":\"Фёдор Достоевский\",\"genres\":[\"Роман\",\"Классика\"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.genres[0]").value("Роман"));
        mvc.perform(put("/api/books/"+id+"/progress").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"positionOffset\":5,\"elapsedSeconds\":60}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.readingSeconds").value(60))
                .andExpect(jsonPath("$.lastReadAt").isNotEmpty());
        mvc.perform(get("/api/books?q=достоевский&status=reading&sort=duration").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].author").value("Фёдор Достоевский"))
                .andExpect(jsonPath("$.items[0].genres[1]").value("Роман"))
                .andExpect(jsonPath("$.items[0].libraryStatus").value("reading"))
                .andExpect(jsonPath("$.items[0].readingSeconds").value(60));
        mvc.perform(delete("/api/documents/"+id).session(session).with(csrf())).andExpect(status().isNoContent());
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
    void migrationsAreAppliedOnceAndLongNotesRoundTrip() {
        assertEquals(12, flyway.info().applied().length);
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
        assertEquals(12, legacy.migrate().migrationsExecuted);
        assertEquals("Keep this record", jdbc.queryForObject("SELECT content FROM legacy_test.note WHERE id = 1", String.class));
        assertEquals("text", jdbc.queryForObject("SELECT data_type FROM information_schema.columns WHERE table_schema = 'legacy_test' AND table_name = 'note' AND column_name = 'content'", String.class));
    }
}

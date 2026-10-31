package afoni.projectf.controller;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
import java.net.*;
import java.net.http.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@Testcontainers
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="spring.config.location=classpath:/application-test.properties")
class SocialMessagingTests {
    @Container static final PostgreSQLContainer database = new PostgreSQLContainer("postgres:17-alpine").withPassword(UUID.randomUUID().toString());
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", database::getJdbcUrl);
        registry.add("spring.datasource.username", database::getUsername);
        registry.add("spring.datasource.password", database::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.core.env.Environment environment;
    @org.springframework.test.context.bean.override.mockito.MockitoBean afoni.projectf.service.LlmSettings llmSettings;
    @org.springframework.test.context.bean.override.mockito.MockitoBean afoni.projectf.service.BookChatClient bookChatClient;
    record Account(UUID id, String username, MockHttpSession session, String email, String password) { }
    Account account() throws Exception {
        String suffix=UUID.randomUUID().toString().replace("-", "").substring(0,12);
        String password=UUID.randomUUID().toString();
        var response=mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\""+suffix+"@example.test\",\"password\":\""+password+"\"}"))
                .andExpect(status().isCreated()).andReturn();
        var session=(MockHttpSession) response.getRequest().getSession(false);
        String username="reader_"+suffix;
        var profile=mvc.perform(put("/api/auth/profile").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\""+username+"\",\"displayName\":\"Читатель\"}"))
                .andExpect(status().isOk()).andReturn();
        return new Account(UUID.fromString(JsonPath.read(profile.getResponse().getContentAsString(),"$.id")), username, session,suffix+"@example.test",password);
    }
    void friends(Account a, Account b) throws Exception {
        mvc.perform(post("/api/friends/"+b.username()+"/request").session(a.session()).with(csrf())).andExpect(status().isCreated());
        mvc.perform(post("/api/friends/"+a.username()+"/accept").session(b.session()).with(csrf())).andExpect(status().isNoContent());
    }
    String open(Account a, Account b) throws Exception {
        var response=mvc.perform(post("/api/social/conversations").session(a.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\""+b.username()+"\"}"))
                .andExpect(status().isOk()).andReturn();
        return JsonPath.read(response.getResponse().getContentAsString(),"$.id");
    }
    long send(Account user, String conversation, UUID client, String extras) throws Exception {
        var response=mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(user.session()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"clientId\":\""+client+"\",\"body\":\"Привет\""+extras+"}"))
                .andExpect(status().isOk()).andReturn();
        return ((Number)JsonPath.read(response.getResponse().getContentAsString(),"$.id")).longValue();
    }
    @Test void conversationRequiresFriendshipAndNeverExposesAnotherConversation() throws Exception {
        var alice=account();var bob=account();var stranger=account();
        mvc.perform(get("/api/social/conversations")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/social/conversations").session(alice.session()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\""+bob.username()+"\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/social/conversations").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\""+bob.username()+"\"}")).andExpect(status().isForbidden());
        friends(alice,bob);String conversation=open(alice,bob);
        assertEquals(conversation,open(bob,alice));
        UUID client=UUID.randomUUID();long message=send(alice,conversation,client,"");
        assertEquals(message,send(alice,conversation,client,""));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM social_messages WHERE conversation_id=?",Integer.class,UUID.fromString(conversation)));
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+client+"\",\"body\":\"Другой текст\"}")).andExpect(status().isConflict());
        mvc.perform(get("/api/social/conversations").session(stranger.session())).andExpect(jsonPath("$").isEmpty());
        for(String path:List.of("","/messages")) mvc.perform(get("/api/social/conversations/"+conversation+path).session(stranger.session())).andExpect(status().isNotFound());
        mvc.perform(put("/api/social/conversations/"+conversation+"/messages/"+message).session(bob.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Не моё\"}")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/social/conversations/"+conversation+"/messages/"+message).session(stranger.session()).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(post("/api/social/conversations/"+conversation+"/read").session(stranger.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"lastId\":"+message+"}")).andExpect(status().isNotFound());
    }
    @Test void readReceiptsAreMonotonicAndNotificationsAreGroupedAndOwned() throws Exception {
        var alice=account();var bob=account();friends(alice,bob);String conversation=open(alice,bob);
        long first=send(alice,conversation,UUID.randomUUID(),"");long last=send(alice,conversation,UUID.randomUUID(),"");
        mvc.perform(get("/api/social/unread").session(bob.session())).andExpect(jsonPath("$.messages").value(2));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM social_notifications WHERE user_id=? AND kind='message'",Integer.class,bob.id()));
        UUID notice=jdbc.queryForObject("SELECT id FROM social_notifications WHERE user_id=? AND kind='message'",UUID.class,bob.id());
        mvc.perform(post("/api/social/notifications/"+notice+"/read").session(alice.session()).with(csrf())).andExpect(status().isNotFound());
        for(long id:List.of(last,first)) mvc.perform(post("/api/social/conversations/"+conversation+"/read").session(bob.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lastId\":"+id+"}")).andExpect(status().isNoContent());
        mvc.perform(get("/api/social/conversations/"+conversation).session(alice.session())).andExpect(jsonPath("$.peerReadId").value(last));
        mvc.perform(get("/api/social/unread").session(bob.session())).andExpect(jsonPath("$.messages").value(0));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("SELECT seen FROM social_notifications WHERE id=?",Boolean.class,notice)));
        mvc.perform(get("/api/social/notifications").session(bob.session()).param("unreadOnly","true")).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(put("/api/social/notification-preferences").session(bob.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"messages\":false,\"friends\":true,\"paused\":false}")).andExpect(status().isOk());
        send(alice,conversation,UUID.randomUUID(),"");
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("SELECT seen FROM social_notifications WHERE id=?",Boolean.class,notice)));
        mvc.perform(get("/api/social/unread").session(bob.session())).andExpect(jsonPath("$.messages").value(1));
    }
    @Test void sharesAreSnapshotsOfOwnedBooksWithSpoilersAndNoFileAccess() throws Exception {
        var alice=account();var bob=account();friends(alice,bob);String conversation=open(alice,bob);
        UUID book=UUID.randomUUID();
        jdbc.update("INSERT INTO documents(id,user_id,title,original_text,source_type,material_type,author) VALUES (?,?,? ,?,'epub','BOOK','Автор')",book,alice.id(),"Название","Начало. Цитата. Конец.");
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(bob.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+UUID.randomUUID()+"\",\"bookId\":\""+book+"\"}")).andExpect(status().isNotFound());
        long message=send(alice,conversation,UUID.randomUUID(),",\"bookId\":\""+book+"\",\"startOffset\":8,\"endOffset\":14");
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session())).andExpect(jsonPath("$.items[0].quote").value("Цитата"))
                .andExpect(jsonPath("$.items[0].spoiler").value(true)).andExpect(jsonPath("$.items[0].sourceDocumentId").doesNotExist());
        mvc.perform(get("/api/books/"+book+"/original").session(bob.session())).andExpect(status().isNotFound());
        long reply=send(bob,conversation,UUID.randomUUID(),",\"replyTo\":"+message);
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(alice.session()))
                .andExpect(jsonPath("$.items[1].reply.text").value("Цитата из книги «Название»"));
        jdbc.update("DELETE FROM documents WHERE id=?",book);
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session())).andExpect(jsonPath("$.items[0].quote").value("Цитата"));
        mvc.perform(delete("/api/social/conversations/"+conversation+"/messages/"+message).session(alice.session()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session())).andExpect(jsonPath("$.items[0].deleted").value(true))
                .andExpect(jsonPath("$.items[0].quote").isEmpty()).andExpect(jsonPath("$.items[1].reply.deleted").value(true));
        assertTrue(reply>message);
    }
    @Test void blockStopsDeliveryAndRateLimitCannotBeBypassedByDirectApi() throws Exception {
        var alice=account();var bob=account();friends(alice,bob);String conversation=open(alice,bob);
        UUID client=UUID.randomUUID();long first=send(alice,conversation,client,"");
        jdbc.update("UPDATE social_rate_limits SET request_count=30 WHERE user_id=? AND action='message'",alice.id());
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+UUID.randomUUID()+"\",\"body\":\"Привет\"}")).andExpect(status().isTooManyRequests());
        assertEquals(first,send(alice,conversation,client,""));
        mvc.perform(post("/api/blocks/"+alice.username()).session(bob.session()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+UUID.randomUUID()+"\",\"body\":\"Нежелательное\"}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/social/conversations/"+conversation).session(alice.session())).andExpect(jsonPath("$.canSend").value(false));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM social_notifications WHERE (user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)",Integer.class,alice.id(),bob.id(),bob.id(),alice.id()));
    }
    @Test void paginationReplyOwnershipAndEditingWorkTogether() throws Exception {
        var alice=account();var bob=account();var charlie=account();friends(alice,bob);friends(alice,charlie);
        String conversation=open(alice,bob),other=open(alice,charlie);
        long foreign=send(alice,other,UUID.randomUUID(),"");
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+UUID.randomUUID()+"\",\"body\":\"Ответ\",\"replyTo\":"+foreign+"}")).andExpect(status().isNotFound());
        long first=send(alice,conversation,UUID.randomUUID(),"");long second=send(bob,conversation,UUID.randomUUID(),"");long third=send(alice,conversation,UUID.randomUUID(),"");
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session()).param("limit","2"))
                .andExpect(jsonPath("$.hasMore").value(true)).andExpect(jsonPath("$.items[0].id").value(second)).andExpect(jsonPath("$.items[1].id").value(third));
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session()).param("before",Long.toString(second)))
                .andExpect(jsonPath("$.items.length()").value(1)).andExpect(jsonPath("$.items[0].id").value(first));
        mvc.perform(put("/api/social/conversations/"+conversation+"/messages/"+first).session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Исправленный текст\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.editedAt").isNotEmpty());
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session()).param("q","исправленный"))
                .andExpect(jsonPath("$.items.length()").value(1)).andExpect(jsonPath("$.items[0].id").value(first));
        mvc.perform(get("/api/social/conversations/"+conversation+"/messages").session(bob.session()).param("q","%_"))
                .andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(post("/api/social/conversations/"+conversation+"/messages").session(alice.session()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\""+UUID.randomUUID()+"\",\"body\":\"  \"}")).andExpect(status().isBadRequest());
    }

    @Test void websocketRejectsAnonymousAndCrossOriginConnections() throws Exception {
        mvc.perform(get("/api/social/events")).andExpect(status().isUnauthorized());
        var user=account();
        mvc.perform(get("/api/social/events").session(user.session()).header("Upgrade","websocket").header("Connection","Upgrade")
                .header("Sec-WebSocket-Version","13").header("Sec-WebSocket-Key",Base64.getEncoder().encodeToString(new byte[16]))
                .header("Origin","https://unrelated.example")).andExpect(status().isForbidden());
    }

    @Test void realWebsocketDeliversAfterSendingAndClosesOnLogout() throws Exception {
        var alice=account();var bob=account();friends(alice,bob);String conversation=open(alice,bob);
        int port=environment.getRequiredProperty("local.server.port",Integer.class);
        String origin="http://127.0.0.1:"+port;
        var cookies=new CookieManager();
        var http=HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(java.time.Duration.ofSeconds(5)).build();
        var csrfResponse=http.send(HttpRequest.newBuilder(URI.create(origin+"/api/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString());
        String token=JsonPath.read(csrfResponse.body(),"$.token"),header=JsonPath.read(csrfResponse.body(),"$.headerName");
        var login=http.send(HttpRequest.newBuilder(URI.create(origin+"/api/auth/login")).header("Content-Type","application/json").header(header,token)
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\""+alice.email()+"\",\"password\":\""+alice.password()+"\"}")).build(),HttpResponse.BodyHandlers.discarding());
        assertEquals(200,login.statusCode());
        String session=cookies.getCookieStore().getCookies().stream().filter(cookie->cookie.getName().equals("JSESSIONID"))
                .findFirst().map(cookie->cookie.getName()+"="+cookie.getValue()).orElseThrow();
        var received=new LinkedBlockingQueue<String>();var closed=new CompletableFuture<Integer>();
        var socket=http.newWebSocketBuilder().header("Cookie",session).header("Origin",origin)
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/api/social/events"),new WebSocket.Listener(){
                    @Override public void onOpen(WebSocket ws){ws.request(1);}
                    @Override public CompletionStage<?> onText(WebSocket ws,CharSequence text,boolean last){received.offer(text.toString());ws.request(1);return null;}
                    @Override public CompletionStage<?> onClose(WebSocket ws,int code,String reason){closed.complete(code);return null;}
                }).get(5,TimeUnit.SECONDS);
        try {
            assertEquals("{\"type\":\"changed\"}",received.poll(5,TimeUnit.SECONDS),"Subscription should be ready before a send");
            send(bob,conversation,UUID.randomUUID(),"");
            assertEquals("{\"type\":\"changed\"}",received.poll(5,TimeUnit.SECONDS));
            var next=http.send(HttpRequest.newBuilder(URI.create(origin+"/api/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString());
            var logout=http.send(HttpRequest.newBuilder(URI.create(origin+"/api/auth/logout")).header(header,JsonPath.read(next.body(),"$.token"))
                    .POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.discarding());
            assertEquals(204,logout.statusCode());
            assertEquals(1000,closed.get(5,TimeUnit.SECONDS));
        } finally { socket.abort(); }
    }
}

package afoni.projectf.service;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.*;

import static org.junit.jupiter.api.Assertions.*;

class DeepSeekBookChatClientTests {
    @Test void sendsBoundedQuestionOnceAndDoesNotExposeProviderErrors() throws Exception {
        var settings=new LlmSettings(new MockEnvironment().withProperty("llm.env-enabled","false").withProperty("LLM_API_KEY","synthetic-test-value"));
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var calls=new AtomicInteger();var body=new AtomicReference<String>();
        server.createContext("/chat",exchange->{
            body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            int call=calls.incrementAndGet();
            String response=call==1
                    ?"{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"Ответ [1].\"}}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":20}}"
                    :"private-provider-error";
            byte[] bytes=response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(call==1?200:503,bytes.length);
            exchange.getResponseBody().write(bytes);exchange.close();
        });
        server.start();
        try {
            var provider=new DeepSeekBookChatClient(settings,URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/chat"));
            var messages=List.of(new BookChatClient.Message("system","Отвечай по тексту."),new BookChatClient.Message("user","Вопрос?"));
            var result=provider.answer(messages,settings.model());
            assertEquals("Ответ [1].",result.answer());assertEquals(100,result.promptTokens());assertEquals(20,result.completionTokens());
            assertTrue(body.get().contains("\"max_tokens\":1200"));
            assertTrue(body.get().contains("\"thinking\":{\"type\":\"disabled\"}"));
            var failure=assertThrows(BookChatClient.Failure.class,()->provider.answer(messages,settings.model()));
            assertFalse(failure.getMessage().contains("private-provider-error"));
            assertEquals(2,calls.get());
        } finally {server.stop(0);}
    }
}

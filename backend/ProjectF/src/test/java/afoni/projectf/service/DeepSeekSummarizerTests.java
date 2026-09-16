package afoni.projectf.service;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class DeepSeekSummarizerTests {
    @Test void acceptsDeepSeekSettingsAndRejectsOtherHostsAndModels() {
        var environment=new MockEnvironment().withProperty("llm.env-enabled","false")
                .withProperty("LLM_API_KEY","synthetic-test-value");
        assertTrue(new LlmSettings(environment).configured());
        assertEquals("deepseek-flash",new LlmSettings(environment).model());
        var wrongHost=new LlmSettings(environment.withProperty("LLM_BASE_URL","https://example.invalid"));
        assertFalse(wrongHost.configured());
        assertEquals("LLM_BASE_URL",wrongHost.configurationIssue());
        assertFalse(new LlmSettings(environment.withProperty("LLM_BASE_URL","https://api.deepseek.com")
                .withProperty("LLM_MODEL","deepseek-chat")).configured());
    }
    @Test void oversizedAndEmptyResponsesAreRetryableAndAccounted() throws Exception {
        var settings=new LlmSettings(new MockEnvironment().withProperty("llm.env-enabled","false").withProperty("LLM_API_KEY","synthetic-test-value"));
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var count=new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/chat",exchange->{
            exchange.getRequestBody().readAllBytes();
            String output=count.incrementAndGet()==1?"я".repeat(1100):"";
            byte[] data=("{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\""+output+"\"}}],\"usage\":{\"total_tokens\":123}}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,data.length);exchange.getResponseBody().write(data);exchange.close();
        });
        server.start();
        try {
            var adapter=new DeepSeekSummarizer(settings,URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/chat"));
            var longAnswer=assertThrows(Summarizer.Failure.class,()->adapter.summarize("Материал","fragment",settings.model()));
            assertTrue(longAnswer.retryable);assertEquals(123,longAnswer.tokens);assertEquals(1100,longAnswer.repairText.length());
            var empty=assertThrows(Summarizer.Failure.class,()->adapter.summarize("Материал","fragment",settings.model()));
            assertTrue(empty.retryable);assertEquals(123,empty.tokens);assertNull(empty.repairText);
        } finally {server.stop(0);}
    }
    @Test void handlesSuccessfulResponseAndRateLimitWithoutExposingProviderBody() throws Exception {
        var settings=new LlmSettings(new MockEnvironment().withProperty("llm.env-enabled","false").withProperty("LLM_API_KEY","synthetic-test-value"));
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var count=new java.util.concurrent.atomic.AtomicInteger();
        var sent=new java.util.concurrent.atomic.AtomicReference<String>();
        server.createContext("/chat",exchange->{
            sent.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            int call=count.incrementAndGet();
            String body=call==1?"{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"Краткое изложение\"}}],\"usage\":{\"total_tokens\":42}}":"do-not-expose-provider-body";
            byte[] data=body.getBytes(StandardCharsets.UTF_8);
            if(call>1) exchange.getResponseHeaders().add("Retry-After","90");
            exchange.sendResponseHeaders(call==1?200:429,data.length);exchange.getResponseBody().write(data);exchange.close();
        });
        server.start();
        try {
            var adapter=new DeepSeekSummarizer(settings,URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/chat"));
            var result=adapter.summarize("Материал","medium",settings.model());
            assertEquals("Краткое изложение",result.text()); assertEquals(42,result.tokens());
            assertTrue(sent.get().contains("\"model\":\"deepseek-flash\""));
            assertTrue(sent.get().contains("\"thinking\":{\"type\":\"disabled\"}"));
            assertTrue(sent.get().contains("\"max_tokens\":3000"));
            assertFalse(sent.get().contains("max_completion_tokens"));
            var failure=assertThrows(Summarizer.Failure.class,()->adapter.summarize("Материал","medium",settings.model()));
            assertTrue(failure.retryable);assertEquals(90,failure.retrySeconds);assertEquals("RATE_LIMIT",failure.code);
            assertFalse(failure.getMessage().contains("do-not-expose"));
        } finally { server.stop(0); }
    }
    @Test void rejectsUnconfiguredProviderAndSplitsUtf8Safely() {
        var settings=new LlmSettings(new MockEnvironment().withProperty("llm.env-enabled","false"));
        assertFalse(settings.configured());
        assertThrows(Summarizer.Failure.class,()->new DeepSeekSummarizer(settings).summarize("Материал","medium",settings.model()));
        String source="Текст 📚漢字 ".repeat(2000);
        var parts=SummaryQueue.split(source);assertEquals(source,String.join("",parts));
        assertTrue(parts.stream().allMatch(part->part.getBytes(StandardCharsets.UTF_8).length<=SummaryQueue.INPUT_BYTES));
    }
}

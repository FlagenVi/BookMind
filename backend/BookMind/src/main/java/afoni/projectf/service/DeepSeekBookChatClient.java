package afoni.projectf.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

@Component
public class DeepSeekBookChatClient implements BookChatClient {
    private final LlmSettings settings;
    private final URI endpoint;
    private final ObjectMapper mapper=new ObjectMapper();
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();

    @Autowired
    public DeepSeekBookChatClient(LlmSettings settings) {this(settings,URI.create("https://api.deepseek.com/chat/completions"));}
    DeepSeekBookChatClient(LlmSettings settings,URI endpoint) {this.settings=settings;this.endpoint=endpoint;}

    @Override public Result answer(List<Message> messages,String model) {
        if(!settings.configured()) throw new Failure("Подключение к DeepSeek не настроено.",0,0);
        try {
            var body=Map.of("model",model,"thinking",Map.of("type","disabled"),"max_tokens",1200,"stream",false,
                    "messages",messages.stream().map(message->Map.of("role",message.role(),"content",message.content())).toList());
            var request=HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(120))
                    .header("Content-Type","application/json").header("Authorization","Bearer "+settings.key())
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()==402) throw new Failure("Недостаточно средств на балансе DeepSeek.",0,0);
            if(response.statusCode()==429) throw new Failure("DeepSeek ограничил частоту запросов. Повторите позже вручную.",0,0);
            if(response.statusCode()!=200) throw new Failure("Не удалось получить ответ DeepSeek. Повторите позже вручную.",0,0);
            var json=mapper.readTree(response.body());
            int prompt=Math.max(0,json.path("usage").path("prompt_tokens").asInt(0));
            int completion=Math.max(0,json.path("usage").path("completion_tokens").asInt(0));
            var choice=json.path("choices").path(0);
            if(!"stop".equals(choice.path("finish_reason").asText()))
                throw new Failure("Ответ достиг лимита модели. Запрос учтён; повтор возможен только вручную.",prompt,completion);
            String answer=choice.path("message").path("content").asText("").strip();
            if(answer.isBlank() || answer.indexOf(0)>=0) throw new Failure("Модель вернула пустой ответ.",prompt,completion);
            return new Result(answer,prompt,completion);
        } catch(Failure failure) {throw failure;}
        catch(InterruptedException interrupted) {Thread.currentThread().interrupt();throw new Failure("Запрос к DeepSeek прерван.",0,0);}
        catch(Exception exception) {throw new Failure("Не удалось связаться с DeepSeek. Повторите позже вручную.",0,0);}
    }
}

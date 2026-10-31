package afoni.projectf.service;

import java.util.List;

public interface BookChatClient {
    record Message(String role,String content) {}
    record Result(String answer,int promptTokens,int completionTokens) {}
    class Failure extends RuntimeException {
        public final int promptTokens;
        public final int completionTokens;
        public Failure(String message,int promptTokens,int completionTokens) {
            super(message);this.promptTokens=promptTokens;this.completionTokens=completionTokens;
        }
    }
    Result answer(List<Message> messages,String model);
}

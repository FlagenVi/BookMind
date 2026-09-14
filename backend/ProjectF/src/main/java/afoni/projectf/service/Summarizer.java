package afoni.projectf.service;

public interface Summarizer {
    record Result(String text, long tokens, long retrySeconds) {
        public Result(String text,long tokens) { this(text,tokens,70); }
    }
    Result summarize(String text, String level, String model);
    class Failure extends RuntimeException {
        public final boolean retryable;
        public final long retrySeconds;
        public final long tokens;
        public final String repairText;
        public Failure(String message, boolean retryable, long retrySeconds) { this(message,retryable,retrySeconds,0,null); }
        public Failure(String message, boolean retryable, long retrySeconds,long tokens,String repairText) {
            super(message); this.retryable=retryable; this.retrySeconds=retrySeconds;this.tokens=tokens;this.repairText=repairText;
        }
    }
}

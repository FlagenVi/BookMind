package afoni.projectf.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration @EnableScheduling
@ConditionalOnProperty(name="app.summary.enabled",havingValue="true",matchIfMissing=true)
public class SummaryWorker {
    private final SummaryQueue queue;
    public SummaryWorker(SummaryQueue queue) { this.queue=queue; }
    @Scheduled(fixedDelay=1000)
    public void tick() {
        try { queue.tick(); } catch(RuntimeException ignored) {
            // Transaction rollback preserves checkpoints. Never log model inputs or credentials.
        }
    }
}

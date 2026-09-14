package afoni.projectf.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration @EnableScheduling
@ConditionalOnProperty(name="app.preparation.enabled", havingValue="true", matchIfMissing=true)
public class PreparationWorker {
    private final DocumentPreparation preparation;
    public PreparationWorker(DocumentPreparation preparation) { this.preparation = preparation; }
    @Scheduled(fixedDelayString="${app.preparation.delay-ms:200}")
    public void tick() { preparation.processNext(); }
}

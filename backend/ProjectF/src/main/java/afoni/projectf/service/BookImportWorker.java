package afoni.projectf.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "app.book-import.enabled", havingValue = "true", matchIfMissing = true)
public class BookImportWorker {
    private final BookImportService imports;

    public BookImportWorker(BookImportService imports) {
        this.imports = imports;
    }

    @Scheduled(fixedDelayString = "${app.book-import.delay-ms:300}")
    public void tick() {
        imports.processNext();
    }
}

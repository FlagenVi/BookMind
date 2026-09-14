package afoni.projectf.repository;

import afoni.projectf.model.Document;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface DocumentRepository extends JpaRepository<Document, UUID> {
    interface Preview {
        UUID getId(); String getTitle(); String getPreview(); java.time.Instant getCreatedAt();
    }
    @org.springframework.data.jpa.repository.Query("select d.id as id, d.title as title, substring(d.originalText,1,200) as preview, d.createdAt as createdAt from Document d where d.userId = :userId")
    Page<Preview> findPreviewsByUserId(UUID userId, Pageable pageable);
    Page<Document> findByUserId(UUID userId, Pageable pageable);
    Optional<Document> findByIdAndUserId(UUID id, UUID userId);
    long countByUserId(UUID userId);
}

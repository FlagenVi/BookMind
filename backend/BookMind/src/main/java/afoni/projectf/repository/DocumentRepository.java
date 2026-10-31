package afoni.projectf.repository;

import afoni.projectf.model.Document;
import afoni.projectf.model.MaterialType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface DocumentRepository extends JpaRepository<Document, UUID> {
    interface Preview {
        UUID getId(); String getTitle(); String getPreview(); String getSourceType(); String getOriginalFilename();
        java.time.Instant getCreatedAt(); java.time.Instant getUpdatedAt();
    }
    @org.springframework.data.jpa.repository.Query("select d.id as id, d.title as title, substring(d.originalText,1,200) as preview, d.sourceType as sourceType, d.originalFilename as originalFilename, d.createdAt as createdAt, d.updatedAt as updatedAt from Document d where d.userId = :userId and d.materialType = :materialType and (:query = '' or locate(:query, lower(d.title)) > 0 or locate(:query, lower(coalesce(d.originalFilename, ''))) > 0) and (:format = 'all' or d.sourceType = :format)")
    Page<Preview> findPreviewsByUserIdAndMaterialType(@Param("userId") UUID userId, @Param("materialType") MaterialType materialType, @Param("query") String query, @Param("format") String format, Pageable pageable);
    Page<Document> findByUserId(UUID userId, Pageable pageable);
    Optional<Document> findByIdAndUserId(UUID id, UUID userId);
    long countByUserId(UUID userId);
}

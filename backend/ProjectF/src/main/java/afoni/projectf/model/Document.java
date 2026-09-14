package afoni.projectf.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name = "documents") @Getter @Setter
public class Document {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(nullable = false, updatable = false)
    private UUID userId;
    @Column(nullable = false, length = 200)
    private String title;
    @Column(nullable = false, columnDefinition = "text")
    private String originalText;
    @Column(nullable = false, length = 10)
    private String sourceType = "manual";
    @Column(length = 255)
    private String originalFilename;
    @CreationTimestamp @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @UpdateTimestamp @Column(nullable = false)
    private Instant updatedAt;
}

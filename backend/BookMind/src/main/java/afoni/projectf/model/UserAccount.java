package afoni.projectf.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
@Getter @Setter
public class UserAccount {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(nullable = false, length = 254)
    private String email;
    @Column(nullable = false, length = 255)
    private String passwordHash;
    @Column(length = 80)
    private String displayName;
    @Column(length = 500)
    private String bio;
    @Column(length = 24)
    private String username;
    @Column(nullable = false, length = 12)
    private String profileVisibility = "private";
    @Column(nullable = false)
    private boolean showLibrary;
    @Column(nullable = false)
    private boolean showStatistics;
    @Column(nullable = false)
    private boolean showActivity;
    @Column(nullable = false)
    private boolean showFriends;
    @Column(columnDefinition = "bytea")
    private byte[] avatarData;
    @Column(length = 40)
    private String avatarContentType;
    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;
}

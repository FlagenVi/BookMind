package afoni.projectf.repository;

import afoni.projectf.model.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.Optional;
import java.util.UUID;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {
    @Query("select u from UserAccount u where lower(trim(u.email)) = :email")
    Optional<UserAccount> findByNormalizedEmail(String email);
}

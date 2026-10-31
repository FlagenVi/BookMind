package afoni.projectf.controller;

import afoni.projectf.model.UserAccount;
import afoni.projectf.repository.UserAccountRepository;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.security.SecurityConfig;
import afoni.projectf.service.UserSessionService;
import afoni.projectf.service.RememberedLoginService;
import afoni.projectf.service.LoginThrottle;
import org.springframework.security.core.AuthenticationException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.Instant;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.UUID;

@RestController @RequestMapping("/api/auth")
public class AuthController {
    private final UserAccountRepository users;
    private final DocumentRepository documents;
    private final PasswordEncoder encoder;
    private final AuthenticationManager manager;
    private final SecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;
    private final UserSessionService sessions;
    private final RememberedLoginService remembered;
    private final JdbcTemplate jdbc;
    private final LoginThrottle throttle;

    public AuthController(UserAccountRepository users, DocumentRepository documents, PasswordEncoder encoder,
                          AuthenticationManager manager, SecurityContextRepository contexts, HttpSessionCsrfTokenRepository csrf,
                          UserSessionService sessions, RememberedLoginService remembered, JdbcTemplate jdbc,
                          LoginThrottle throttle) {
        this.users = users; this.documents = documents; this.encoder = encoder;
        this.manager = manager; this.contexts = contexts; this.csrf = csrf;
        this.sessions = sessions;
        this.remembered = remembered;
        this.jdbc = jdbc;
        this.throttle = throttle;
    }

    public record Credentials(@NotBlank @Email @Size(max=254) String email,
                              @NotBlank @Size(min=12, max=128) String password,
                              Boolean rememberMe) {
        public Credentials { if (email != null) email = SecurityConfig.normalizeEmail(email); }
        @Override public String toString() { return "Credentials[redacted]"; }
    }
    public record Profile(UUID id, String email, String displayName, String bio, boolean hasAvatar,
                          Instant avatarUpdatedAt, Instant createdAt, long documentCount,
                          String username, String visibility, boolean showLibrary, boolean showStatistics,
                          boolean showActivity, boolean showFriends, List<String> favoriteGenres,
                          List<UUID> featuredBookIds) {}
    public record ProfileUpdate(@Size(max=80) String displayName, @Size(max=500) String bio,
                                @Pattern(regexp="[a-z][a-z0-9_]{2,23}") String username,
                                @Pattern(regexp="public|friends|private") String visibility,
                                Boolean showLibrary, Boolean showStatistics, Boolean showActivity, Boolean showFriends,
                                @Size(max=6) List<@NotBlank @Size(max=60) String> favoriteGenres,
                                @Size(max=6) List<@NotNull UUID> featuredBookIds) {}
    public record CsrfResponse(String token, String headerName) {}

    @GetMapping("/csrf") CsrfResponse csrf(CsrfToken token) { return new CsrfResponse(token.getToken(), token.getHeaderName()); }

    @PostMapping("/register") @ResponseStatus(HttpStatus.CREATED)
    Profile register(@Valid @RequestBody Credentials input, HttpServletRequest request, HttpServletResponse response) {
        if (users.findByNormalizedEmail(input.email()).isPresent())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email уже используется");
        var account = new UserAccount();
        account.setEmail(input.email());
        account.setPasswordHash(encoder.encode(input.password()));
        users.saveAndFlush(account);
        return signIn(input, request, response);
    }

    @PostMapping("/login") Profile login(@Valid @RequestBody Credentials input, HttpServletRequest request, HttpServletResponse response) {
        return signIn(input, request, response);
    }

    private Profile signIn(Credentials input, HttpServletRequest request, HttpServletResponse response) {
        // Checked before the password, so a correct guess after the limit is still rejected.
        if (throttle.blocked(input.email()))
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Слишком много неудачных попыток входа. Попробуйте через 15 минут");
        Authentication auth;
        try {
            auth = manager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(input.email(), input.password()));
        } catch (AuthenticationException failure) {
            throttle.failed(input.email());
            throw failure;
        }
        throttle.succeeded(input.email());
        new ChangeSessionIdAuthenticationStrategy().onAuthentication(auth, request, response);
        new CsrfAuthenticationStrategy(csrf).onAuthentication(auth, request, response);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        sessions.register(auth, request);
        remembered.onSignIn(Boolean.TRUE.equals(input.rememberMe()), auth, request, response);
        return profile(auth);
    }

    @GetMapping("/me") Profile me(Authentication auth, HttpServletRequest request) {
        sessions.register(auth, request);
        return profile(auth);
    }

    @PutMapping("/profile") @Transactional
    Profile updateProfile(Authentication auth, @Valid @RequestBody ProfileUpdate input) {
        var account = account(auth);
        if(input.displayName()!=null) account.setDisplayName(clean(input.displayName()));
        if(input.bio()!=null) account.setBio(clean(input.bio()));
        if(input.username()!=null) account.setUsername(input.username().toLowerCase(Locale.ROOT));
        if(input.visibility()!=null) account.setProfileVisibility(input.visibility());
        if(input.showLibrary()!=null) account.setShowLibrary(input.showLibrary());
        if(input.showStatistics()!=null) account.setShowStatistics(input.showStatistics());
        if(input.showActivity()!=null) account.setShowActivity(input.showActivity());
        if(input.showFriends()!=null) account.setShowFriends(input.showFriends());
        users.saveAndFlush(account);
        if(input.favoriteGenres()!=null) {
            var genres=new LinkedHashSet<String>();
            for(String value:input.favoriteGenres()) {
                String genre=value.strip();
                if(genre.isBlank() || genres.stream().anyMatch(item->item.equalsIgnoreCase(genre)))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Укажите разные любимые жанры");
                genres.add(genre);
            }
            jdbc.update("DELETE FROM profile_genres WHERE user_id=?",account.getId());
            int position=0;
            for(String genre:genres) jdbc.update("INSERT INTO profile_genres(user_id,genre,position) VALUES (?,?,?)",account.getId(),genre,position++);
        }
        if(input.featuredBookIds()!=null) {
            var bookIds=new LinkedHashSet<>(input.featuredBookIds());
            if(bookIds.size()!=input.featuredBookIds().size())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Книги не должны повторяться");
            for(UUID bookId:bookIds) {
                Boolean owned=jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM documents WHERE id=? AND user_id=? AND material_type='BOOK')",Boolean.class,bookId,account.getId());
                if(!Boolean.TRUE.equals(owned)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите книгу из своей библиотеки");
            }
            jdbc.update("DELETE FROM profile_featured_books WHERE user_id=?",account.getId());
            int position=0;
            for(UUID bookId:bookIds) jdbc.update("INSERT INTO profile_featured_books(user_id,document_id,position) VALUES (?,?,?)",account.getId(),bookId,position++);
        }
        return toProfile(account);
    }

    @PostMapping(value="/profile/avatar", consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @Transactional
    Profile uploadAvatar(Authentication auth, @RequestPart("file") MultipartFile file) throws java.io.IOException {
        byte[] content = file.getBytes();
        String type = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        if (content.length == 0 || content.length > 2 * 1024 * 1024 || !validImage(type, content))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Выберите изображение PNG, JPEG или WebP размером до 2 МБ");
        var account = account(auth);
        account.setAvatarData(content);
        account.setAvatarContentType(type);
        return toProfile(users.saveAndFlush(account));
    }

    @GetMapping("/profile/avatar")
    ResponseEntity<byte[]> avatar(Authentication auth) {
        var account = account(auth);
        if (account.getAvatarData() == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(account.getAvatarContentType()))
                .cacheControl(CacheControl.noCache().cachePrivate()).body(account.getAvatarData());
    }

    @DeleteMapping("/profile/avatar") @Transactional
    Profile deleteAvatar(Authentication auth) {
        var account = account(auth);
        account.setAvatarData(null);
        account.setAvatarContentType(null);
        return toProfile(users.saveAndFlush(account));
    }

    @GetMapping("/sessions")
    List<UserSessionService.UserSession> sessions(Authentication auth, HttpServletRequest request) {
        return sessions.list(auth, request);
    }

    @DeleteMapping("/sessions/{sessionId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeSession(Authentication auth, HttpServletRequest request, HttpServletResponse response,
                       @PathVariable String sessionId) {
        sessions.revoke(auth, request, response, sessionId);
    }

    @DeleteMapping("/sessions") @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeOtherSessions(Authentication auth, HttpServletRequest request) {
        sessions.revokeOthers(auth, request);
    }

    private Profile profile(Authentication auth) {
        return toProfile(account(auth));
    }

    private UserAccount account(Authentication auth) {
        var account = users.findById(UUID.fromString(auth.getName()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return account;
    }

    private Profile toProfile(UserAccount account) {
        var genres=jdbc.query("SELECT genre FROM profile_genres WHERE user_id=? ORDER BY position",(rs,n)->rs.getString(1),account.getId());
        var books=jdbc.query("SELECT document_id FROM profile_featured_books WHERE user_id=? ORDER BY position",(rs,n)->rs.getObject(1,UUID.class),account.getId());
        return new Profile(account.getId(), account.getEmail(), account.getDisplayName(), account.getBio(),
                account.getAvatarData() != null, account.getUpdatedAt(), account.getCreatedAt(),
                documents.countByUserId(account.getId()),account.getUsername(),account.getProfileVisibility(),
                account.isShowLibrary(),account.isShowStatistics(),account.isShowActivity(),account.isShowFriends(),genres,books);
    }

    private String clean(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }

    private boolean validImage(String type, byte[] content) {
        if (type.equals("image/png"))
            return content.length >= 8 && content[0] == (byte)0x89 && content[1] == 0x50 && content[2] == 0x4e && content[3] == 0x47;
        if (type.equals("image/jpeg"))
            return content.length >= 3 && content[0] == (byte)0xff && content[1] == (byte)0xd8 && content[2] == (byte)0xff;
        if (type.equals("image/webp"))
            return content.length >= 12 && content[0] == 'R' && content[1] == 'I' && content[2] == 'F' && content[3] == 'F'
                    && content[8] == 'W' && content[9] == 'E' && content[10] == 'B' && content[11] == 'P';
        return false;
    }
}

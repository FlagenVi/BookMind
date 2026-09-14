package afoni.projectf.controller;

import afoni.projectf.model.UserAccount;
import afoni.projectf.repository.UserAccountRepository;
import afoni.projectf.repository.DocumentRepository;
import afoni.projectf.security.SecurityConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
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
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.UUID;

@RestController @RequestMapping("/api/auth")
public class AuthController {
    private final UserAccountRepository users;
    private final DocumentRepository documents;
    private final PasswordEncoder encoder;
    private final AuthenticationManager manager;
    private final SecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;

    public AuthController(UserAccountRepository users, DocumentRepository documents, PasswordEncoder encoder,
                          AuthenticationManager manager, SecurityContextRepository contexts, HttpSessionCsrfTokenRepository csrf) {
        this.users = users; this.documents = documents; this.encoder = encoder;
        this.manager = manager; this.contexts = contexts; this.csrf = csrf;
    }

    public record Credentials(@NotBlank @Email @Size(max=254) String email,
                              @NotBlank @Size(min=12, max=128) String password) {
        public Credentials { if (email != null) email = SecurityConfig.normalizeEmail(email); }
        @Override public String toString() { return "Credentials[redacted]"; }
    }
    public record Profile(UUID id, String email, Instant createdAt, long documentCount) {}
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
        var auth = manager.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(input.email(), input.password()));
        new ChangeSessionIdAuthenticationStrategy().onAuthentication(auth, request, response);
        new CsrfAuthenticationStrategy(csrf).onAuthentication(auth, request, response);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
        return me(auth);
    }

    @GetMapping("/me") Profile me(Authentication auth) {
        var account = users.findById(UUID.fromString(auth.getName()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return new Profile(account.getId(), account.getEmail(), account.getCreatedAt(), documents.countByUserId(account.getId()));
    }
}

package afoni.projectf.service;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

@Service
public class RememberedLoginService {
    private static final String COOKIE_NAME = "PROJECTF_REMEMBER";
    private static final Duration VALIDITY = Duration.ofDays(30);
    private final JdbcTemplate jdbc;
    private final SecureRandom random = new SecureRandom();

    public RememberedLoginService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Login(UUID id, UUID userId, String tokenHash, Instant expiresAt) {}
    private record CookieValue(UUID id, String token) {}

    public void onSignIn(boolean rememberMe, Authentication authentication,
                         HttpServletRequest request, HttpServletResponse response) {
        revokeCookie(request);
        if (!rememberMe) {
            clearCookie(request, response);
            return;
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UUID id = UUID.randomUUID();
        jdbc.update("DELETE FROM remembered_logins WHERE expires_at <= CURRENT_TIMESTAMP");
        jdbc.update("INSERT INTO remembered_logins(id,user_id,token_hash,session_id,expires_at) VALUES (?,?,?,?,?)",
                id, UUID.fromString(authentication.getName()), hash(token), request.getSession().getId(),
                Timestamp.from(Instant.now().plus(VALIDITY)));
        writeCookie(request, response, id + "." + token, VALIDITY);
    }

    public Optional<Login> find(HttpServletRequest request) {
        var cookie = cookie(request);
        if (cookie.isEmpty()) return Optional.empty();
        CookieValue value = cookie.get();
        var rows = jdbc.query("SELECT user_id,token_hash,expires_at FROM remembered_logins WHERE id=?",
                (result, row) -> new Login(value.id(), result.getObject(1, UUID.class),
                        result.getString(2), result.getTimestamp(3).toInstant()), value.id());
        if (rows.isEmpty()) return Optional.empty();
        Login login = rows.getFirst();
        if (!login.expiresAt().isAfter(Instant.now())) {
            jdbc.update("DELETE FROM remembered_logins WHERE id=?", value.id());
            return Optional.empty();
        }
        byte[] actual = sha256(value.token());
        byte[] expected;
        try { expected = HexFormat.of().parseHex(login.tokenHash().trim()); }
        catch (IllegalArgumentException invalid) { return Optional.empty(); }
        return MessageDigest.isEqual(actual, expected) ? Optional.of(login) : Optional.empty();
    }

    public void bindSession(UUID id, String sessionId) {
        jdbc.update("UPDATE remembered_logins SET session_id=?,last_used_at=CURRENT_TIMESTAMP WHERE id=?",
                sessionId, id);
    }

    public void revokeSession(String sessionId) {
        jdbc.update("DELETE FROM remembered_logins WHERE session_id=?", sessionId);
    }

    public void revokeOthers(Authentication authentication, HttpServletRequest request) {
        UUID userId = UUID.fromString(authentication.getName());
        var current = find(request);
        if (current.isPresent() && current.get().userId().equals(userId))
            jdbc.update("DELETE FROM remembered_logins WHERE user_id=? AND id<>?", userId, current.get().id());
        else jdbc.update("DELETE FROM remembered_logins WHERE user_id=?", userId);
    }

    public void logout(HttpServletRequest request, HttpServletResponse response) {
        revokeCookie(request);
        clearCookie(request, response);
    }

    private void revokeCookie(HttpServletRequest request) {
        cookie(request).ifPresent(value -> {
            if (find(request).isPresent())
                jdbc.update("DELETE FROM remembered_logins WHERE id=?", value.id());
        });
    }

    public void clearCookie(HttpServletRequest request, HttpServletResponse response) {
        writeCookie(request, response, "", Duration.ZERO);
    }

    private void writeCookie(HttpServletRequest request, HttpServletResponse response, String value, Duration maxAge) {
        boolean secure = request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"));
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(COOKIE_NAME, value)
                .httpOnly(true).secure(secure).sameSite("Lax").path("/api")
                .maxAge(maxAge).build().toString());
    }

    private Optional<CookieValue> cookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return Optional.empty();
        return Arrays.stream(cookies).filter(value -> COOKIE_NAME.equals(value.getName()))
                .map(value -> value.getValue().split("\\.", 2))
                .filter(parts -> parts.length == 2 && parts[1].length() == 43)
                .map(parts -> {
                    try { return new CookieValue(UUID.fromString(parts[0]), parts[1]); }
                    catch (IllegalArgumentException invalid) { return null; }
                }).filter(java.util.Objects::nonNull).findFirst();
    }

    private String hash(String value) {
        return HexFormat.of().formatHex(sha256(value));
    }

    private byte[] sha256(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}

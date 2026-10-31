package afoni.projectf.service;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.session.SessionInformation;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static org.springframework.http.HttpStatus.NOT_FOUND;

@Service
public class UserSessionService {
    private final SessionRegistry registry;
    private final JdbcTemplate jdbc;
    private final RememberedLoginService remembered;

    public UserSessionService(SessionRegistry registry, JdbcTemplate jdbc, RememberedLoginService remembered) {
        this.registry = registry;
        this.jdbc = jdbc;
        this.remembered = remembered;
    }

    public record UserSession(String id, String browser, String operatingSystem, String deviceType,
                              Instant createdAt, Instant lastActiveAt, boolean current) {}

    private record Metadata(String id, String userAgent, Instant createdAt) {}

    public void register(Authentication authentication, HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null || authentication == null) return;
        if (registry.getSessionInformation(session.getId()) == null)
            registry.registerNewSession(session.getId(), authentication.getPrincipal());
        jdbc.update("INSERT INTO user_sessions(session_id,user_id,user_agent) VALUES (?,?,?) " +
                        "ON CONFLICT(session_id) DO UPDATE SET user_id=excluded.user_id,user_agent=excluded.user_agent",
                session.getId(), UUID.fromString(authentication.getName()), userAgent(request));
    }

    public List<UserSession> list(Authentication authentication, HttpServletRequest request) {
        register(authentication, request);
        UUID userId = UUID.fromString(authentication.getName());
        String currentId = request.getSession(false).getId();
        var metadata = jdbc.query("SELECT session_id,user_agent,created_at FROM user_sessions WHERE user_id=?",
                (rs, row) -> new Metadata(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant()), userId);
        return metadata.stream().map(item -> {
                    SessionInformation session = registry.getSessionInformation(item.id());
                    if (session == null || session.isExpired() || !ownedBy(session, authentication.getName())) return null;
                    String agent = item.userAgent();
                    return new UserSession(item.id(), browser(agent), operatingSystem(agent), deviceType(agent),
                            item.createdAt(), session.getLastRequest().toInstant(), item.id().equals(currentId));
                }).filter(java.util.Objects::nonNull)
                .sorted(Comparator.comparing(UserSession::current).reversed()
                        .thenComparing(UserSession::lastActiveAt, Comparator.reverseOrder()))
                .toList();
    }

    public boolean revoke(Authentication authentication, HttpServletRequest request,
                          HttpServletResponse response, String sessionId) {
        SessionInformation session = registry.getSessionInformation(sessionId);
        if (session == null || !ownedBy(session, authentication.getName())) throw new ResponseStatusException(NOT_FOUND);
        boolean current = request.getSession(false) != null && request.getSession(false).getId().equals(sessionId);
        jdbc.update("DELETE FROM user_sessions WHERE session_id=? AND user_id=?", sessionId,
                UUID.fromString(authentication.getName()));
        remembered.revokeSession(sessionId);
        if (current) {
            remembered.logout(request, response);
            request.getSession(false).invalidate();
        }
        else session.expireNow();
        return current;
    }

    public void revokeOthers(Authentication authentication, HttpServletRequest request) {
        String currentId = request.getSession(false).getId();
        remembered.revokeOthers(authentication, request);
        for (var session : activeSessions(authentication)) {
            if (session.getSessionId().equals(currentId)) continue;
            session.expireNow();
            jdbc.update("DELETE FROM user_sessions WHERE session_id=? AND user_id=?", session.getSessionId(),
                    UUID.fromString(authentication.getName()));
        }
    }

    private List<SessionInformation> activeSessions(Authentication authentication) {
        Object principal = registry.getAllPrincipals().stream()
                .filter(value -> principalName(value).equals(authentication.getName()))
                .findFirst().orElse(authentication.getPrincipal());
        return registry.getAllSessions(principal, false);
    }

    private boolean ownedBy(SessionInformation session, String userId) {
        return principalName(session.getPrincipal()).equals(userId);
    }

    private String principalName(Object principal) {
        if (principal instanceof UserDetails details) return details.getUsername();
        return String.valueOf(principal);
    }

    private String userAgent(HttpServletRequest request) {
        String value = request.getHeader("User-Agent");
        if (value == null) return "";
        return value.substring(0, Math.min(500, value.length()));
    }

    private String browser(String agent) {
        if (agent.contains("Edg/")) return "Microsoft Edge";
        if (agent.contains("OPR/") || agent.contains("Opera")) return "Opera";
        if (agent.contains("Firefox/")) return "Firefox";
        if (agent.contains("Chrome/")) return "Google Chrome";
        if (agent.contains("Safari/")) return "Safari";
        return "Неизвестный браузер";
    }

    private String operatingSystem(String agent) {
        String lower = agent.toLowerCase(Locale.ROOT);
        if (lower.contains("windows")) return "Windows";
        if (lower.contains("iphone") || lower.contains("ipad")) return "iOS";
        if (lower.contains("android")) return "Android";
        if (lower.contains("mac os") || lower.contains("macintosh")) return "macOS";
        if (lower.contains("linux")) return "Linux";
        return "Неизвестная система";
    }

    private String deviceType(String agent) {
        String lower = agent.toLowerCase(Locale.ROOT);
        if (lower.contains("ipad") || lower.contains("tablet")) return "TABLET";
        if (lower.contains("mobile") || lower.contains("iphone") || lower.contains("android")) return "MOBILE";
        return "DESKTOP";
    }
}

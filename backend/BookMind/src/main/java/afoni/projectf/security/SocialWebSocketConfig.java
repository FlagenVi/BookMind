package afoni.projectf.security;

import afoni.projectf.service.SocialEvents;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.*;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.server.HandshakeInterceptor;
import java.util.Map;

@Configuration
@EnableWebSocket
public class SocialWebSocketConfig implements WebSocketConfigurer {
    private final SocialEvents events;
    public SocialWebSocketConfig(SocialEvents events) { this.events = events; }
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(events, "/api/social/events").addInterceptors(new HandshakeInterceptor() {
            @Override public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                    WebSocketHandler handler, Map<String, Object> attributes) {
                if (!(request instanceof ServletServerHttpRequest servlet)) return false;
                var session = servlet.getServletRequest().getSession(false);
                if (session == null || request.getPrincipal() == null) return false;
                attributes.put("httpSessionId", session.getId());
                return true;
            }
            @Override public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                    WebSocketHandler handler, Exception exception) { }
        }); // Spring's default same-origin check is intentionally retained.
    }
}

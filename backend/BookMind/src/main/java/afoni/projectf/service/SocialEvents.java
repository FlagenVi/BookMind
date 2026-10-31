package afoni.projectf.service;

import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.web.session.HttpSessionDestroyedEvent;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Events contain no messages or profile data. Clients fetch authorized HTTP resources again. */
@Component
public class SocialEvents extends TextWebSocketHandler {
    private final Map<UUID, Set<WebSocketSession>> connections = new ConcurrentHashMap<>();

    @Override public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        if (session.getPrincipal() == null) { session.close(CloseStatus.NOT_ACCEPTABLE); return; }
        UUID user = UUID.fromString(session.getPrincipal().getName());
        var accepted = new AtomicBoolean();
        connections.compute(user, (id, current) -> {
            var sessions = current == null ? ConcurrentHashMap.<WebSocketSession>newKeySet() : current;
            if (sessions.size() < 6) { sessions.add(session); accepted.set(true); }
            return sessions;
        });
        if (!accepted.get()) { session.close(CloseStatus.POLICY_VIOLATION); return; }
        // Sent after registration, so clients can fetch a snapshot with no handshake race.
        send(session, new TextMessage("{\"type\":\"changed\"}"));
    }
    @Override protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        session.close(CloseStatus.POLICY_VIOLATION);
    }
    @Override public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        if (session.getPrincipal() == null) return;
        UUID user = UUID.fromString(session.getPrincipal().getName());
        connections.computeIfPresent(user, (id, sessions) -> { sessions.remove(session); return sessions.isEmpty() ? null : sessions; });
    }
    public void changed(UUID... users) {
        Runnable publish = () -> Arrays.stream(users).distinct().forEach(user -> {
            var sessions = connections.get(user);
            if (sessions != null) sessions.forEach(session -> send(session, new TextMessage("{\"type\":\"changed\"}")));
        });
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { publish.run(); }
            });
        } else publish.run();
    }
    @Scheduled(fixedDelay = 25000)
    public void heartbeat() {
        connections.values().forEach(sessions -> sessions.forEach(session -> send(session, new PingMessage())));
    }
    @EventListener public void logout(HttpSessionDestroyedEvent event) {
        connections.values().forEach(sessions -> sessions.forEach(session -> {
            if (event.getId().equals(session.getAttributes().get("httpSessionId"))) close(session);
        }));
    }
    private void send(WebSocketSession session, WebSocketMessage<?> message) {
        try { synchronized (session) { if (session.isOpen()) session.sendMessage(message); } }
        catch (Exception ignored) { close(session); }
    }
    private void close(WebSocketSession session) {
        try { session.close(CloseStatus.NORMAL); } catch (Exception ignored) { }
    }
}

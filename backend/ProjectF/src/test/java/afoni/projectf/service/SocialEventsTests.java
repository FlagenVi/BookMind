package afoni.projectf.service;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.socket.*;
import java.util.UUID;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class SocialEventsTests {
    @Test void onlyTheRecipientIsNotifiedAndOnlyAfterTheCommit() throws Exception {
        var events=new SocialEvents();
        UUID alice=UUID.randomUUID(),bob=UUID.randomUUID();
        var first=mock(WebSocketSession.class);var second=mock(WebSocketSession.class);
        when(first.getPrincipal()).thenReturn(alice::toString);when(first.isOpen()).thenReturn(true);
        when(second.getPrincipal()).thenReturn(bob::toString);when(second.isOpen()).thenReturn(true);
        events.afterConnectionEstablished(first);events.afterConnectionEstablished(second);
        clearInvocations(first,second);
        TransactionSynchronizationManager.initSynchronization();
        try {
            events.changed(alice);
            verify(first,never()).sendMessage(any());
            TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
            verify(first).sendMessage(any(TextMessage.class));
            verify(second,never()).sendMessage(any());
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
        events.afterConnectionClosed(first,CloseStatus.NORMAL);
        events.changed(alice);
        verify(first,times(1)).sendMessage(any());
    }
    @Test void anonymousSocketIsClosedBeforeSubscription() throws Exception {
        var events=new SocialEvents();var socket=mock(WebSocketSession.class);
        events.afterConnectionEstablished(socket);
        verify(socket).close(CloseStatus.NOT_ACCEPTABLE);
        events.changed(UUID.randomUUID());
        verify(socket,never()).sendMessage(any());
    }
}

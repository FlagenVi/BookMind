package afoni.projectf.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;

@Service
public class SocialMessaging {
    private final JdbcTemplate jdbc;
    private final SocialEvents events;
    public SocialMessaging(JdbcTemplate jdbc, SocialEvents events) { this.jdbc = jdbc; this.events = events; }

    public record Person(String username, String displayName) { }
    public record Reply(long id, String author, String text, boolean deleted) { }
    public record Message(long id, UUID senderId, boolean mine, String body, Instant createdAt,
                          Instant editedAt, boolean deleted, Reply reply,
                          String bookTitle, String bookAuthor, String quote, boolean spoiler) { }
    public record Conversation(UUID id, Person person, boolean canSend, long unread,
                               long peerReadId, Message lastMessage) { }
    public record MessagePage(List<Message> items, boolean hasMore) { }
    public record Input(UUID clientId, String body, Long replyTo, UUID bookId,
                        Integer startOffset, Integer endOffset, Boolean spoiler) { }
    public record Notice(UUID id, String kind, Person actor, UUID conversationId, boolean seen, Instant occurredAt) { }
    public record NoticePage(List<Notice> items, boolean hasMore) { }
    public record Preferences(boolean messages, boolean friends, boolean paused) { }
    public record Unread(long messages, long notifications) { }
    private record Members(UUID peer) { }

    public List<Conversation> conversations(UUID user) {
        return describe(user, null);
    }
    public Conversation conversation(UUID user, UUID id) {
        var rows = describe(user, id);
        if (rows.isEmpty()) throw missing();
        return rows.getFirst();
    }
    private List<Conversation> describe(UUID user, UUID id) {
        return jdbc.query("SELECT c.id,u.username,u.display_name," +
                "EXISTS(SELECT 1 FROM friend_connections f WHERE ((f.user_low=c.user_low AND f.user_high=c.user_high) OR (f.user_low=c.user_high AND f.user_high=c.user_low)) AND f.status='accepted') " +
                "AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?)) AS can_send," +
                "COALESCE(r.last_read_id,0) AS peer_read," +
                "(SELECT count(*) FROM social_messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.deleted_at IS NULL " +
                "AND m.id>COALESCE((SELECT last_read_id FROM social_reads WHERE conversation_id=c.id AND user_id=?),0)) AS unread " +
                "FROM social_conversations c JOIN users u ON u.id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END " +
                "LEFT JOIN social_reads r ON r.conversation_id=c.id AND r.user_id=u.id " +
                "WHERE (c.user_low=? OR c.user_high=?) AND (?::uuid IS NULL OR c.id=?) ORDER BY c.updated_at DESC,c.id LIMIT 100",
            (rs, n) -> {
                UUID conversation = rs.getObject("id", UUID.class);
                var last = jdbc.query(messageSql() + " WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 1",
                        (row, index) -> message(row, user), conversation);
                return new Conversation(conversation, new Person(rs.getString("username"), rs.getString("display_name")),
                        rs.getBoolean("can_send"), rs.getLong("unread"), rs.getLong("peer_read"), last.isEmpty() ? null : last.getFirst());
            }, user, user, user, user, user, user, user, id, id);
    }

    @Transactional public Conversation open(UUID user, String username) {
        UUID peer = target(username);
        if (peer.equals(user)) throw bad("Нельзя написать самому себе");
        lockUsers(user, peer);
        requireFriends(user, peer);
        UUID low = user.compareTo(peer) < 0 ? user : peer, high = low.equals(user) ? peer : user;
        jdbc.update("INSERT INTO social_conversations(id,user_low,user_high) VALUES (?,?,?) ON CONFLICT (user_low,user_high) DO NOTHING",
                UUID.randomUUID(), low, high);
        UUID id = jdbc.queryForObject("SELECT id FROM social_conversations WHERE user_low=? AND user_high=?", UUID.class, low, high);
        events.changed(user, peer);
        return conversation(user, id);
    }

    public MessagePage messages(UUID user, UUID id, Long before, int limit, String query) {
        members(user, id);
        if (limit < 1 || limit > 100 || (before != null && before < 1)) throw bad("Некорректная страница сообщений");
        String search = query == null ? "" : query.strip();
        if (search.length() > 100) throw bad("Поисковый запрос не должен превышать 100 символов");
        var rows = new ArrayList<>(jdbc.query(messageSql() + " WHERE m.conversation_id=? AND (?::bigint IS NULL OR m.id<?) " +
                "AND (?='' OR (m.deleted_at IS NULL AND position(lower(?) in lower(m.body||COALESCE(m.book_title,'')||COALESCE(m.quote_text,'')))>0)) ORDER BY m.id DESC LIMIT ?",
                (rs, n) -> message(rs, user), id, before, before, search, search, limit + 1));
        boolean more = rows.size() > limit;
        if (more) rows.removeLast();
        Collections.reverse(rows);
        return new MessagePage(rows, more);
    }

    @Transactional public Message send(UUID user, UUID id, Input input) {
        UUID peer = members(user, id).peer();
        lockUsers(user, peer);
        requireFriends(user, peer);
        if (input.clientId() == null) throw bad("Не указан идентификатор сообщения");
        String body = clean(input.body());
        String hash = fingerprint(input, body);
        var duplicates = jdbc.query("SELECT id,conversation_id,request_hash FROM social_messages WHERE sender_id=? AND client_id=?",
                (rs, n) -> new Object[]{rs.getLong(1), rs.getObject(2, UUID.class), rs.getString(3)}, user, input.clientId());
        if (!duplicates.isEmpty()) {
            var previous = duplicates.getFirst();
            if (!id.equals(previous[1]) || !hash.equals(previous[2])) throw new ResponseStatusException(HttpStatus.CONFLICT, "Этот идентификатор уже использован");
            return findMessage(user, id, (long) previous[0]);
        }
        limit(user, "message", 30, 60);
        String title = null, author = null, quote = null;
        if (input.bookId() != null) {
            var books = jdbc.query("SELECT title,author FROM documents WHERE id=? AND user_id=? AND material_type='BOOK'",
                    (rs, n) -> new String[]{rs.getString(1), rs.getString(2)}, input.bookId(), user);
            if (books.isEmpty()) throw missing();
            title = books.getFirst()[0]; author = books.getFirst()[1];
        }
        if (input.startOffset() != null || input.endOffset() != null) {
            if (title == null || input.startOffset() == null || input.endOffset() == null) throw bad("Выберите книгу и границы цитаты");
            int start = input.startOffset(), end = input.endOffset();
            if (start < 0 || end <= start || end - start > 10000) throw bad("Цитата должна содержать от 1 до 10 000 символов");
            String text = jdbc.queryForObject("SELECT original_text FROM documents WHERE id=? AND user_id=?", String.class, input.bookId(), user);
            if (text == null || end > text.length()) throw bad("Фрагмент больше недоступен. Выделите текст заново");
            quote = text.substring(start, end);
        }
        if (body.isEmpty() && title == null) throw bad("Напишите сообщение или выберите книгу");
        if (input.replyTo() != null) findMessage(user, id, input.replyTo());
        Long messageId = jdbc.queryForObject("INSERT INTO social_messages(conversation_id,sender_id,client_id,request_hash,body,reply_to,source_document_id,book_title,book_author,quote_text,spoiler) " +
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id", Long.class,
                id, user, input.clientId(), hash, body, input.replyTo(), input.bookId(), title, author, quote, !Boolean.FALSE.equals(input.spoiler()));
        jdbc.update("UPDATE social_conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?", id);
        notify(peer, user, "message", id.toString(), id);
        events.changed(user, peer);
        return findMessage(user, id, messageId);
    }

    @Transactional public Message edit(UUID user, UUID id, long messageId, String text) {
        UUID peer = members(user, id).peer(); lockUsers(user, peer); requireFriends(user, peer);
        Message previous = findMessage(user, id, messageId);
        if (!previous.mine() || previous.deleted()) throw missing();
        String body = clean(text);
        if (body.isEmpty() && previous.bookTitle() == null) throw bad("Сообщение не может быть пустым");
        limit(user, "edit", 60, 60);
        jdbc.update("UPDATE social_messages SET body=?,edited_at=CURRENT_TIMESTAMP WHERE id=? AND sender_id=?", body, messageId, user);
        events.changed(user, peer);
        return findMessage(user, id, messageId);
    }

    @Transactional public void delete(UUID user, UUID id, long messageId) {
        UUID peer = members(user, id).peer(); lockUsers(user, peer);
        Message previous = findMessage(user, id, messageId);
        if (!previous.mine()) throw missing();
        jdbc.update("UPDATE social_messages SET body='',book_title=NULL,book_author=NULL,quote_text=NULL,source_document_id=NULL,deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP) WHERE id=? AND sender_id=?", messageId, user);
        events.changed(user, peer);
    }

    @Transactional public void read(UUID user, UUID id, long lastId) {
        UUID peer = members(user, id).peer(); lockUsers(user, peer);
        findMessage(user, id, lastId);
        jdbc.update("INSERT INTO social_reads(conversation_id,user_id,last_read_id) VALUES (?,?,?) ON CONFLICT (conversation_id,user_id) " +
                "DO UPDATE SET last_read_id=GREATEST(social_reads.last_read_id,EXCLUDED.last_read_id)", id, user, lastId);
        // A newer message may have arrived after this tab fetched its page.
        jdbc.update("UPDATE social_notifications SET seen=TRUE WHERE user_id=? AND conversation_id=? AND kind='message' " +
                "AND NOT EXISTS(SELECT 1 FROM social_messages WHERE conversation_id=? AND sender_id<>? AND id>? AND deleted_at IS NULL)", user, id, id, user, lastId);
        events.changed(user, peer);
    }

    public Unread unread(UUID user) {
        Long messages = jdbc.queryForObject("SELECT count(*) FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id " +
                "LEFT JOIN social_reads r ON r.conversation_id=c.id AND r.user_id=? WHERE (c.user_low=? OR c.user_high=?) AND m.sender_id<>? AND m.deleted_at IS NULL AND m.id>COALESCE(r.last_read_id,0)", Long.class, user, user, user, user);
        Long notices = jdbc.queryForObject("SELECT count(*) FROM social_notifications WHERE user_id=? AND NOT seen", Long.class, user);
        return new Unread(messages == null ? 0 : messages, notices == null ? 0 : notices);
    }
    public NoticePage notices(UUID user, int page, boolean unreadOnly) {
        if (page < 0 || page > 10000) throw bad("Некорректная страница");
        var rows = new ArrayList<>(jdbc.query("SELECT n.id,n.kind,u.username,u.display_name,n.conversation_id,n.seen,n.occurred_at " +
                "FROM social_notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? AND (NOT ? OR NOT n.seen) ORDER BY n.occurred_at DESC,n.id DESC LIMIT 41 OFFSET ?",
                (rs, n) -> new Notice(rs.getObject(1, UUID.class), rs.getString(2), new Person(rs.getString(3), rs.getString(4)),
                        rs.getObject(5, UUID.class), rs.getBoolean(6), rs.getTimestamp(7).toInstant()), user, unreadOnly, page * 40));
        boolean more = rows.size() > 40; if (more) rows.removeLast();
        return new NoticePage(rows, more);
    }
    @Transactional public void seen(UUID user, UUID id) {
        if (id == null) jdbc.update("UPDATE social_notifications SET seen=TRUE WHERE user_id=? AND NOT seen", user);
        else if (jdbc.update("UPDATE social_notifications SET seen=TRUE WHERE user_id=? AND id=?", user, id) != 1) throw missing();
        events.changed(user);
    }
    public Preferences preferences(UUID user) {
        var rows = jdbc.query("SELECT messages,friends,paused FROM social_notification_preferences WHERE user_id=?",
                (rs, n) -> new Preferences(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3)), user);
        return rows.isEmpty() ? new Preferences(true, true, false) : rows.getFirst();
    }
    @Transactional public Preferences preferences(UUID user, Preferences input) {
        jdbc.update("INSERT INTO social_notification_preferences(user_id,messages,friends,paused) VALUES (?,?,?,?) ON CONFLICT(user_id) " +
                "DO UPDATE SET messages=EXCLUDED.messages,friends=EXCLUDED.friends,paused=EXCLUDED.paused", user, input.messages(), input.friends(), input.paused());
        events.changed(user); return input;
    }
    public void notify(UUID user, UUID actor, String kind, String key, UUID conversation) {
        Preferences preference = preferences(user);
        if (preference.paused() || (kind.equals("message") ? !preference.messages() : !preference.friends())) return;
        jdbc.update("INSERT INTO social_notifications(id,user_id,actor_id,kind,event_key,conversation_id) VALUES (?,?,?,?,?,?) " +
                "ON CONFLICT(user_id,kind,event_key) DO UPDATE SET actor_id=EXCLUDED.actor_id,seen=FALSE,occurred_at=CURRENT_TIMESTAMP", UUID.randomUUID(), user, actor, kind, key, conversation);
        events.changed(user);
    }
    public void friendshipChanged(UUID first, UUID second) { events.changed(first, second); }
    public void clearFriendRequest(UUID first, UUID second) {
        jdbc.update("UPDATE social_notifications SET seen=TRUE WHERE kind='friend_request' AND ((user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?))", first, second, second, first);
    }
    public void blocked(UUID first, UUID second) {
        jdbc.update("DELETE FROM social_notifications WHERE (user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)", first, second, second, first);
        events.changed(first, second);
    }
    public void lockUsers(UUID first, UUID second) {
        jdbc.query("SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE", (rs, n) -> rs.getObject(1, UUID.class), first, second);
    }
    public void limit(UUID user, String action, int maximum, int seconds) {
        Integer count = jdbc.queryForObject("INSERT INTO social_rate_limits(user_id,action) VALUES (?,?) ON CONFLICT(user_id,action) DO UPDATE SET " +
                "request_count=CASE WHEN social_rate_limits.window_start<CURRENT_TIMESTAMP-(? * INTERVAL '1 second') THEN 1 ELSE social_rate_limits.request_count+1 END," +
                "window_start=CASE WHEN social_rate_limits.window_start<CURRENT_TIMESTAMP-(? * INTERVAL '1 second') THEN CURRENT_TIMESTAMP ELSE social_rate_limits.window_start END RETURNING request_count",
                Integer.class, user, action, seconds, seconds);
        if (count != null && count > maximum) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много действий. Попробуйте чуть позже");
    }
    private UUID target(String username) {
        var rows = jdbc.query("SELECT id FROM users WHERE lower(username)=lower(?)", (rs, n) -> rs.getObject(1, UUID.class), username);
        if (rows.isEmpty()) throw missing(); return rows.getFirst();
    }
    private Members members(UUID user, UUID id) {
        var rows = jdbc.query("SELECT CASE WHEN user_low=? THEN user_high ELSE user_low END FROM social_conversations WHERE id=? AND (user_low=? OR user_high=?)",
                (rs, n) -> new Members(rs.getObject(1, UUID.class)), user, id, user, user);
        if (rows.isEmpty()) throw missing(); return rows.getFirst();
    }
    private void requireFriends(UUID user, UUID peer) {
        boolean friends = Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM friend_connections WHERE ((user_low=? AND user_high=?) OR (user_low=? AND user_high=?)) AND status='accepted') " +
                "AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))", Boolean.class, user, peer, peer, user, user, peer, peer, user));
        if (!friends) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Переписка доступна только друзьям без взаимных блокировок");
    }
    private Message findMessage(UUID user, UUID conversation, long id) {
        var rows = jdbc.query(messageSql() + " WHERE m.conversation_id=? AND m.id=?", (rs, n) -> message(rs, user), conversation, id);
        if (rows.isEmpty()) throw missing(); return rows.getFirst();
    }
    private static String messageSql() {
        return "SELECT m.*,r.id AS reply_id,r.body AS reply_body,r.book_title AS reply_book,r.quote_text AS reply_quote,r.deleted_at AS reply_deleted," +
                "COALESCE(u.display_name,u.username,'Читатель') AS reply_author FROM social_messages m " +
                "LEFT JOIN social_messages r ON r.id=m.reply_to LEFT JOIN users u ON u.id=r.sender_id";
    }
    private static Message message(ResultSet rs, UUID user) throws SQLException {
        UUID sender = rs.getObject("sender_id", UUID.class);
        boolean deleted = rs.getTimestamp("deleted_at") != null;
        Reply reply = null;
        if (rs.getObject("reply_id") != null) {
            boolean gone = rs.getTimestamp("reply_deleted") != null;
            String preview = gone ? "Сообщение удалено" : rs.getString("reply_quote") != null ? "Цитата из книги «" + rs.getString("reply_book") + "»" : rs.getString("reply_body");
            if (!gone && (preview == null || preview.isBlank())) preview = "Книга «" + rs.getString("reply_book") + "»";
            reply = new Reply(rs.getLong("reply_id"), rs.getString("reply_author"), preview.length() > 160 ? preview.substring(0, 160) + "…" : preview, gone);
        }
        return new Message(rs.getLong("id"), sender, sender.equals(user), deleted ? "" : rs.getString("body"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("edited_at") == null ? null : rs.getTimestamp("edited_at").toInstant(), deleted, reply,
                deleted ? null : rs.getString("book_title"), deleted ? null : rs.getString("book_author"), deleted ? null : rs.getString("quote_text"), rs.getBoolean("spoiler"));
    }
    private static String clean(String body) {
        String result = body == null ? "" : body.strip();
        if (result.length() > 4000) throw bad("Сообщение не должно превышать 4000 символов"); return result;
    }
    private static String fingerprint(Input input, String body) {
        try {
            String value = body.length() + ":" + body + "|" + input.replyTo() + "|" + input.bookId() + "|" + input.startOffset() + "|" + input.endOffset() + "|" + !Boolean.FALSE.equals(input.spoiler());
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND); }
    private static ResponseStatusException bad(String text) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, text); }
}

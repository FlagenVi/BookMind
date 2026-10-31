package afoni.projectf.controller;

import afoni.projectf.service.SocialMessaging;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

@RestController
public class SocialGraphController {
    private final JdbcTemplate jdbc;
    private final SocialMessaging social;

    public SocialGraphController(JdbcTemplate jdbc, SocialMessaging social) { this.jdbc=jdbc; this.social=social; }

    record Person(String username,String displayName,boolean hasAvatar) {}
    record Request(String username,String displayName,boolean hasAvatar,boolean incoming) {}
    private record Pair(UUID low,UUID high) {
        static Pair of(UUID first,UUID second) {
            return first.compareTo(second)<0?new Pair(first,second):new Pair(second,first);
        }
    }

    @GetMapping("/api/friends")
    List<Person> friends(Authentication auth) {
        UUID user=user(auth);
        return jdbc.query("SELECT u.username,u.display_name,u.avatar_data IS NOT NULL FROM friend_connections c "+
                        "JOIN users u ON u.id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END "+
                        "WHERE (c.user_low=? OR c.user_high=?) AND c.status='accepted' AND u.username IS NOT NULL ORDER BY lower(u.username)",
                (rs,n)->new Person(rs.getString(1),rs.getString(2),rs.getBoolean(3)),user,user,user);
    }

    @GetMapping("/api/friends/requests")
    List<Request> requests(Authentication auth) {
        UUID user=user(auth);
        return jdbc.query("SELECT u.username,u.display_name,u.avatar_data IS NOT NULL,c.requested_by<>? FROM friend_connections c "+
                        "JOIN users u ON u.id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END "+
                        "WHERE (c.user_low=? OR c.user_high=?) AND c.status='pending' AND u.username IS NOT NULL ORDER BY c.created_at DESC",
                (rs,n)->new Request(rs.getString(1),rs.getString(2),rs.getBoolean(3),rs.getBoolean(4)),user,user,user,user);
    }

    @PostMapping("/api/friends/{username}/request") @ResponseStatus(HttpStatus.CREATED) @Transactional
    void request(Authentication auth,@PathVariable String username) {
        UUID user=user(auth),target=target(username);
        if(user.equals(target)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Нельзя отправить заявку себе");
        social.lockUsers(user,target);
        if(blocked(user,target)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        social.limit(user,"friend_request",20,3600);
        Pair pair=Pair.of(user,target);
        int changed=jdbc.update("INSERT INTO friend_connections(user_low,user_high,requested_by,status) VALUES (?,?,?,'pending') ON CONFLICT DO NOTHING",
                pair.low(),pair.high(),user);
        if(changed==0) throw new ResponseStatusException(HttpStatus.CONFLICT,"Заявка или дружба уже существует");
        social.notify(target,user,"friend_request",user.toString(),null);
        social.friendshipChanged(user,target);
    }

    @PostMapping("/api/friends/{username}/accept") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void accept(Authentication auth,@PathVariable String username) {
        UUID user=user(auth),target=target(username);
        social.lockUsers(user,target);
        if(blocked(user,target)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Pair pair=Pair.of(user,target);
        if(jdbc.update("UPDATE friend_connections SET status='accepted' WHERE user_low=? AND user_high=? AND status='pending' AND requested_by=?",
                pair.low(),pair.high(),target)!=1) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        social.clearFriendRequest(user,target);
        social.notify(target,user,"friend_accepted",user.toString(),null);
        social.friendshipChanged(user,target);
    }

    @DeleteMapping("/api/friends/{username}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void remove(Authentication auth,@PathVariable String username) {
        UUID user=user(auth),target=target(username);Pair pair=Pair.of(user,target);
        social.lockUsers(user,target);
        if(jdbc.update("DELETE FROM friend_connections WHERE user_low=? AND user_high=?",pair.low(),pair.high())!=1)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        social.clearFriendRequest(user,target);
        social.friendshipChanged(user,target);
    }

    @GetMapping("/api/blocks")
    List<Person> blocks(Authentication auth) {
        return jdbc.query("SELECT u.username,u.display_name,u.avatar_data IS NOT NULL FROM user_blocks b JOIN users u ON u.id=b.blocked_id "+
                        "WHERE b.user_id=? AND u.username IS NOT NULL ORDER BY b.created_at DESC",
                (rs,n)->new Person(rs.getString(1),rs.getString(2),rs.getBoolean(3)),user(auth));
    }

    @PostMapping("/api/blocks/{username}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void block(Authentication auth,@PathVariable String username) {
        UUID user=user(auth),target=target(username);
        if(user.equals(target)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Нельзя заблокировать себя");
        social.lockUsers(user,target);
        Pair pair=Pair.of(user,target);
        jdbc.update("DELETE FROM friend_connections WHERE user_low=? AND user_high=?",pair.low(),pair.high());
        jdbc.update("INSERT INTO user_blocks(user_id,blocked_id) VALUES (?,?) ON CONFLICT DO NOTHING",user,target);
        social.blocked(user,target);
    }

    @DeleteMapping("/api/blocks/{username}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    void unblock(Authentication auth,@PathVariable String username) {
        jdbc.update("DELETE FROM user_blocks WHERE user_id=? AND blocked_id=?",user(auth),target(username));
        social.friendshipChanged(user(auth),target(username));
    }

    private UUID target(String username) {
        var ids=jdbc.query("SELECT id FROM users WHERE lower(username)=lower(?)",(rs,n)->rs.getObject(1,UUID.class),username);
        if(ids.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return ids.getFirst();
    }
    private boolean blocked(UUID user,UUID target) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))",
                Boolean.class,user,target,target,user));
    }
    private UUID user(Authentication auth) { return UUID.fromString(auth.getName()); }
}

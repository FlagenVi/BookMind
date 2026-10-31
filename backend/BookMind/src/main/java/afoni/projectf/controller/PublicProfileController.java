package afoni.projectf.controller;

import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

@RestController
@RequestMapping("/api/profiles")
public class PublicProfileController {
    private final JdbcTemplate jdbc;

    public PublicProfileController(JdbcTemplate jdbc) { this.jdbc=jdbc; }

    record Person(String username,String displayName,boolean hasAvatar) {}
    record PublicBook(UUID id,String title,String author,boolean hasCover) {}
    record PublicStats(long readingMinutes,long booksFinished) {}
    record ActivityDay(String date,long minutes) {}
    record Profile(String username,String displayName,String bio,boolean hasAvatar,String visibility,
                   String relationship,List<String> favoriteGenres,List<PublicBook> featuredBooks,
                   PublicStats statistics,List<ActivityDay> activity,List<Person> friends,
                   boolean libraryVisible,boolean statisticsVisible,boolean activityVisible,boolean friendsVisible) {}
    private record Target(UUID id,String username,String displayName,String bio,boolean hasAvatar,String visibility,
                          boolean showLibrary,boolean showStatistics,boolean showActivity,boolean showFriends) {}

    @GetMapping("/search")
    List<Person> search(Authentication auth,@RequestParam String q) {
        String query=q.strip().toLowerCase(Locale.ROOT);
        if(query.length()<2 || query.length()>24) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Введите от 2 до 24 символов");
        UUID viewer=user(auth);
        return jdbc.query("SELECT username,display_name,avatar_data IS NOT NULL FROM users u WHERE username IS NOT NULL AND profile_visibility<>'private' AND left(lower(username),char_length(?))=? "+
                        "AND (?::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=u.id AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=u.id))) "+
                        "ORDER BY CASE WHEN lower(username)=? THEN 0 ELSE 1 END,lower(username) LIMIT 20",
                (rs,n)->new Person(rs.getString(1),rs.getString(2),rs.getBoolean(3)),query,query,viewer,viewer,viewer,query);
    }

    @GetMapping("/{username}")
    Profile profile(Authentication auth,@PathVariable String username) {
        Target target=visibleTarget(auth,username);UUID viewer=user(auth);
        boolean own=target.id().equals(viewer);
        String relationship=relationship(viewer,target.id());
        var genres=jdbc.query("SELECT genre FROM profile_genres WHERE user_id=? ORDER BY position",(rs,n)->rs.getString(1),target.id());
        var featured=jdbc.query("SELECT d.id,d.title,d.author,EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover) "+
                        "FROM profile_featured_books p JOIN documents d ON d.id=p.document_id WHERE p.user_id=? AND d.user_id=? AND d.material_type='BOOK' ORDER BY p.position",
                (rs,n)->new PublicBook(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getBoolean(4)),target.id(),target.id());
        PublicStats stats=null;
        if(target.showStatistics() || own) {
            long minutes=Optional.ofNullable(jdbc.queryForObject("SELECT COALESCE(sum(s.duration_seconds),0)/60 FROM reading_sessions s JOIN documents d ON d.id=s.document_id WHERE s.user_id=? AND d.user_id=? AND d.material_type='BOOK'",Long.class,target.id(),target.id())).orElse(0L);
            long finished=Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM documents WHERE user_id=? AND material_type='BOOK' AND finished_at IS NOT NULL",Long.class,target.id())).orElse(0L);
            stats=new PublicStats(minutes,finished);
        }
        List<ActivityDay> activity=List.of();
        if(target.showActivity() || own) activity=jdbc.query("SELECT (s.ended_at AT TIME ZONE 'UTC')::date::text,COALESCE(sum(s.duration_seconds),0)/60 "+
                        "FROM reading_sessions s JOIN documents d ON d.id=s.document_id WHERE s.user_id=? AND d.user_id=? AND d.material_type='BOOK' "+
                        "AND s.ended_at>=CURRENT_TIMESTAMP-INTERVAL '365 days' GROUP BY 1 ORDER BY 1",
                (rs,n)->new ActivityDay(rs.getString(1),rs.getLong(2)),target.id(),target.id());
        List<Person> friends=List.of();
        if(target.showFriends() || own) friends=jdbc.query("SELECT u.username,u.display_name,u.avatar_data IS NOT NULL FROM friend_connections c "+
                        "JOIN users u ON u.id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END "+
                        "WHERE (c.user_low=? OR c.user_high=?) AND c.status='accepted' AND u.username IS NOT NULL "+
                        "AND (? OR u.profile_visibility='public' OR u.id=?) "+
                        "AND (?::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=u.id AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=u.id))) "+
                        "ORDER BY lower(u.username) LIMIT 100",
                (rs,n)->new Person(rs.getString(1),rs.getString(2),rs.getBoolean(3)),target.id(),target.id(),target.id(),own,viewer,viewer,viewer,viewer);
        return new Profile(target.username(),target.displayName(),target.bio(),target.hasAvatar(),target.visibility(),
                relationship,genres,featured,stats,activity,friends,target.showLibrary() || own,
                target.showStatistics() || own,target.showActivity() || own,target.showFriends() || own);
    }

    @GetMapping("/{username}/books")
    List<PublicBook> library(Authentication auth,@PathVariable String username,@RequestParam(defaultValue="0") int page) {
        if(page<0 || page>10000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        Target target=visibleTarget(auth,username);
        if(!target.showLibrary() && !target.id().equals(user(auth))) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return jdbc.query("SELECT d.id,d.title,d.author,EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover) "+
                        "FROM documents d WHERE d.user_id=? AND d.material_type='BOOK' ORDER BY d.created_at DESC,d.id LIMIT 20 OFFSET ?",
                (rs,n)->new PublicBook(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getBoolean(4)),target.id(),page*20);
    }

    @GetMapping("/{username}/avatar")
    ResponseEntity<byte[]> avatar(Authentication auth,@PathVariable String username) {
        Target target=visibleTarget(auth,username);
        var rows=jdbc.query("SELECT avatar_data,avatar_content_type FROM users WHERE id=?",
                (rs,n)->new Object[]{rs.getBytes(1),rs.getString(2)},target.id());
        if(rows.isEmpty() || rows.getFirst()[0]==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType((String)rows.getFirst()[1]))
                .header("X-Content-Type-Options","nosniff").header(HttpHeaders.CACHE_CONTROL,"private, no-cache")
                .body((byte[])rows.getFirst()[0]);
    }

    @GetMapping("/{username}/books/{bookId}/cover")
    ResponseEntity<byte[]> cover(Authentication auth,@PathVariable String username,@PathVariable UUID bookId) {
        Target target=visibleTarget(auth,username);
        if(!target.showLibrary() && !target.id().equals(user(auth)) && !Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM profile_featured_books WHERE user_id=? AND document_id=?)",
                Boolean.class,target.id(),bookId))) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var rows=jdbc.query("SELECT a.content,a.media_type FROM book_assets a JOIN documents d ON d.id=a.document_id "+
                        "WHERE d.id=? AND d.user_id=? AND d.material_type='BOOK' AND a.is_cover ORDER BY a.id LIMIT 1",
                (rs,n)->new Object[]{rs.getBytes(1),rs.getString(2)},bookId,target.id());
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return BookController.imageResponse((byte[])rows.getFirst()[0],(String)rows.getFirst()[1]);
    }

    private Target visibleTarget(Authentication auth,String username) {
        var rows=jdbc.query("SELECT id,username,display_name,bio,avatar_data IS NOT NULL,profile_visibility,show_library,show_statistics,show_activity,show_friends "+
                        "FROM users WHERE lower(username)=lower(?)",
                (rs,n)->new Target(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getString(4),rs.getBoolean(5),
                        rs.getString(6),rs.getBoolean(7),rs.getBoolean(8),rs.getBoolean(9),rs.getBoolean(10)),username);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Target target=rows.getFirst();UUID viewer=user(auth);
        if(target.id().equals(viewer)) return target;
        if(viewer!=null && blocked(viewer,target.id())) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if("public".equals(target.visibility())) return target;
        if("friends".equals(target.visibility()) && "friends".equals(relationship(viewer,target.id()))) return target;
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private boolean blocked(UUID viewer,UUID target) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))",
                Boolean.class,viewer,target,target,viewer));
    }
    private String relationship(UUID viewer,UUID target) {
        if(viewer==null) return "none";
        if(viewer.equals(target)) return "self";
        var rows=jdbc.query("SELECT status,requested_by FROM friend_connections WHERE (user_low=? AND user_high=?) OR (user_low=? AND user_high=?)",
                (rs,n)->new Object[]{rs.getString(1),rs.getObject(2,UUID.class)},viewer,target,target,viewer);
        if(rows.isEmpty()) return "none";
        if("accepted".equals(rows.getFirst()[0])) return "friends";
        return viewer.equals(rows.getFirst()[1])?"outgoing":"incoming";
    }
    private UUID user(Authentication auth) {
        return auth==null || auth instanceof AnonymousAuthenticationToken?null:UUID.fromString(auth.getName());
    }
}

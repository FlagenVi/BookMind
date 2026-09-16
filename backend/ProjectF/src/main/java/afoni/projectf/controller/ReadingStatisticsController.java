package afoni.projectf.controller;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.*;
import java.util.*;

@RestController
@RequestMapping("/api/reading")
public class ReadingStatisticsController {
    private static final int APPROXIMATE_PAGE_CHARACTERS=1800;
    private final JdbcTemplate jdbc;

    public ReadingStatisticsController(JdbcTemplate jdbc) { this.jdbc=jdbc; }

    record PeriodStats(long durationSeconds,long charactersRead,long approximatePages,long averageCharactersPerMinute,long booksFinished) {}
    record ActivityDay(LocalDate date,long durationSeconds,long charactersRead) {}
    record CurrentBook(UUID id,String title,String format,boolean hasCover,int progressPercent,Long remainingSeconds) {}
    record ReadingGoal(int dailyMinutes,int monthlyBooks) {}
    record ReadingGoalInput(@Min(0) @Max(1440) int dailyMinutes,@Min(0) @Max(100) int monthlyBooks) {}
    record LibrarySummary(long totalBooks,long readingBooks,long finishedBooks,long bookmarks,long notes) {}
    record GenreStat(String genre,long books) {}
    record Statistics(PeriodStats day,PeriodStats week,PeriodStats month,List<ActivityDay> activity,
                      CurrentBook currentBook,ReadingGoal goal,LibrarySummary library,List<GenreStat> genres) {}
    private record Aggregate(long duration,long characters) {}
    private record SessionRow(Instant endedAt,long duration,long characters) {}

    @GetMapping("/statistics")
    Statistics statistics(Authentication auth,@RequestParam(defaultValue="UTC") String timezone) {
        UUID user=owner(auth);ZoneId zone;
        try { zone=ZoneId.of(timezone); }
        catch(DateTimeException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Неизвестный часовой пояс"); }
        LocalDate today=LocalDate.now(zone);
        Instant dayStart=today.atStartOfDay(zone).toInstant();
        Instant weekStart=today.minusDays(today.getDayOfWeek().getValue()-1L).atStartOfDay(zone).toInstant();
        Instant monthStart=today.withDayOfMonth(1).atStartOfDay(zone).toInstant();
        PeriodStats day=period(user,dayStart),week=period(user,weekStart),month=period(user,monthStart);
        return new Statistics(day,week,month,activity(user,zone,today),currentBook(user,month),goal(user),library(user),genres(user));
    }

    @PutMapping("/goal")
    ReadingGoal saveGoal(Authentication auth,@Valid @RequestBody ReadingGoalInput input) {
        UUID user=owner(auth);
        jdbc.update("INSERT INTO reading_goals(user_id,daily_minutes,monthly_books) VALUES (?,?,?) "+
                        "ON CONFLICT(user_id) DO UPDATE SET daily_minutes=EXCLUDED.daily_minutes,monthly_books=EXCLUDED.monthly_books,updated_at=CURRENT_TIMESTAMP",
                user,input.dailyMinutes(),input.monthlyBooks());
        return new ReadingGoal(input.dailyMinutes(),input.monthlyBooks());
    }

    private PeriodStats period(UUID user,Instant since) {
        Aggregate aggregate=jdbc.query("SELECT COALESCE(sum(s.duration_seconds),0),COALESCE(sum(s.characters_read),0) FROM reading_sessions s JOIN documents d ON d.id=s.document_id WHERE s.user_id=? AND d.material_type='BOOK' AND s.ended_at>=?",
                rs->{rs.next();return new Aggregate(rs.getLong(1),rs.getLong(2));},user,java.sql.Timestamp.from(since));
        long books=Optional.ofNullable(jdbc.queryForObject("SELECT count(*) FROM documents WHERE user_id=? AND material_type='BOOK' AND finished_at>=?",Long.class,user,java.sql.Timestamp.from(since))).orElse(0L);
        return new PeriodStats(aggregate.duration(),aggregate.characters(),pages(aggregate.characters()),speed(aggregate),books);
    }

    private List<ActivityDay> activity(UUID user,ZoneId zone,LocalDate today) {
        LocalDate first=today.minusDays(364);Instant since=first.atStartOfDay(zone).toInstant();
        Map<LocalDate,long[]> values=new LinkedHashMap<>();
        for(int day=0;day<365;day++) values.put(first.plusDays(day),new long[2]);
        var sessions=jdbc.query("SELECT s.ended_at,s.duration_seconds,s.characters_read FROM reading_sessions s JOIN documents d ON d.id=s.document_id WHERE s.user_id=? AND d.material_type='BOOK' AND s.ended_at>=? ORDER BY s.ended_at",
                (rs,n)->new SessionRow(rs.getTimestamp(1).toInstant(),rs.getLong(2),rs.getLong(3)),user,java.sql.Timestamp.from(since));
        for(var session:sessions) {
            LocalDate date=session.endedAt().atZone(zone).toLocalDate();long[] value=values.get(date);
            if(value!=null) {value[0]+=session.duration();value[1]+=session.characters();}
        }
        return values.entrySet().stream().map(entry->new ActivityDay(entry.getKey(),entry.getValue()[0],entry.getValue()[1])).toList();
    }

    private CurrentBook currentBook(UUID user,PeriodStats month) {
        var books=jdbc.query("SELECT d.id,d.title,d.source_type,EXISTS(SELECT 1 FROM book_assets a WHERE a.document_id=d.id AND a.is_cover),"+
                        "length(d.original_text),r.position_offset,r.confirmed_offset FROM reading_progress r JOIN documents d ON d.id=r.document_id "+
                        "WHERE r.user_id=? AND d.material_type='BOOK' AND d.library_status='reading' AND r.last_read_at IS NOT NULL ORDER BY r.last_read_at DESC LIMIT 1",
                (rs,n)->new Object[]{rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getBoolean(4),rs.getInt(5),rs.getInt(6),rs.getInt(7)},user);
        if(books.isEmpty()) return null;Object[] book=books.getFirst();int length=(Integer)book[4],position=(Integer)book[5],confirmed=(Integer)book[6];
        long speed=month.averageCharactersPerMinute();Long remaining=speed>0?Math.round(Math.max(0,length-confirmed)*60.0/speed):null;
        int progress=length==0?0:(int)Math.min(100,Math.round(position*100.0/length));
        return new CurrentBook((UUID)book[0],(String)book[1],(String)book[2],(Boolean)book[3],progress,remaining);
    }

    private ReadingGoal goal(UUID user) {
        var goals=jdbc.query("SELECT daily_minutes,monthly_books FROM reading_goals WHERE user_id=?",
                (rs,n)->new ReadingGoal(rs.getInt(1),rs.getInt(2)),user);
        return goals.isEmpty()?new ReadingGoal(20,2):goals.getFirst();
    }

    private LibrarySummary library(UUID user) {
        return jdbc.query("SELECT count(*),count(*) FILTER (WHERE library_status='reading'),count(*) FILTER (WHERE library_status='finished'),"+
                        "(SELECT count(*) FROM reader_bookmarks b JOIN documents bd ON bd.id=b.document_id WHERE b.user_id=? AND bd.material_type='BOOK'),"+
                        "(SELECT count(*) FROM reader_highlights h JOIN documents hd ON hd.id=h.document_id WHERE h.user_id=? AND hd.material_type='BOOK' AND h.note IS NOT NULL AND length(trim(h.note))>0) "+
                        "FROM documents WHERE user_id=? AND material_type='BOOK'",
                rs->{rs.next();return new LibrarySummary(rs.getLong(1),rs.getLong(2),rs.getLong(3),rs.getLong(4),rs.getLong(5));},user,user,user);
    }

    private List<GenreStat> genres(UUID user) {
        return jdbc.query("SELECT min(g.genre),count(DISTINCT g.document_id) AS books FROM book_genres g "+
                        "JOIN documents d ON d.id=g.document_id WHERE d.user_id=? AND d.material_type='BOOK' GROUP BY lower(g.genre) ORDER BY books DESC,lower(g.genre)",
                (rs,n)->new GenreStat(rs.getString(1),rs.getLong(2)),user);
    }

    private long pages(long characters) { return characters==0?0:(long)Math.ceil(characters/(double)APPROXIMATE_PAGE_CHARACTERS); }
    private long speed(Aggregate value) { return value.duration()==0?0:Math.round(value.characters()*60.0/value.duration()); }
    private UUID owner(Authentication auth) { return UUID.fromString(auth.getName()); }
}

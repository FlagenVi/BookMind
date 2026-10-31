package afoni.projectf.service;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Limits password guessing per account. Counted by email rather than address, so a reverse proxy
 * that hides client addresses cannot lock out every user at once. State lives in memory: one instance.
 */
@Component
public class LoginThrottle {
    public static final int MAX_FAILURES = 10;
    public static final Duration WINDOW = Duration.ofMinutes(15);
    private static final int CLEANUP_THRESHOLD = 10_000;

    private record Failures(Instant start, int count) {}

    private final Map<String, Failures> failures = new ConcurrentHashMap<>();
    private final Clock clock;

    public LoginThrottle() { this(Clock.systemUTC()); }
    LoginThrottle(Clock clock) { this.clock = clock; }

    public boolean blocked(String email) {
        var current = failures.get(email);
        return current != null && !expired(current) && current.count() >= MAX_FAILURES;
    }

    public void failed(String email) {
        if (failures.size() > CLEANUP_THRESHOLD) failures.values().removeIf(this::expired);
        failures.compute(email, (key, current) -> current == null || expired(current)
                ? new Failures(clock.instant(), 1) : new Failures(current.start(), current.count() + 1));
    }

    public void succeeded(String email) { failures.remove(email); }

    private boolean expired(Failures value) { return value.start().plus(WINDOW).isBefore(clock.instant()); }
}

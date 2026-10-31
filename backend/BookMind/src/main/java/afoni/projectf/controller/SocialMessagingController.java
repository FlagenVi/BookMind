package afoni.projectf.controller;

import afoni.projectf.service.SocialMessaging;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/social")
public class SocialMessagingController {
    private final SocialMessaging social;
    public SocialMessagingController(SocialMessaging social) { this.social = social; }
    record Open(@NotBlank @Size(max=24) String username) { }
    record Edit(@NotNull @Size(max=4000) String body) { }
    record Read(@Min(1) long lastId) { }
    @GetMapping("/conversations") List<SocialMessaging.Conversation> conversations(Authentication auth) { return social.conversations(user(auth)); }
    @PostMapping("/conversations") SocialMessaging.Conversation open(Authentication auth, @Valid @RequestBody Open input) { return social.open(user(auth), input.username()); }
    @GetMapping("/conversations/{id}") SocialMessaging.Conversation conversation(Authentication auth, @PathVariable UUID id) { return social.conversation(user(auth), id); }
    @GetMapping("/conversations/{id}/messages") SocialMessaging.MessagePage messages(Authentication auth, @PathVariable UUID id,
            @RequestParam(required=false) Long before, @RequestParam(defaultValue="40") int limit,
            @RequestParam(defaultValue="") String q) { return social.messages(user(auth), id, before, limit, q); }
    @PostMapping("/conversations/{id}/messages") SocialMessaging.Message send(Authentication auth, @PathVariable UUID id,
            @RequestBody SocialMessaging.Input input) { return social.send(user(auth), id, input); }
    @PutMapping("/conversations/{id}/messages/{messageId}") SocialMessaging.Message edit(Authentication auth, @PathVariable UUID id,
            @PathVariable long messageId, @Valid @RequestBody Edit input) { return social.edit(user(auth), id, messageId, input.body()); }
    @DeleteMapping("/conversations/{id}/messages/{messageId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable UUID id, @PathVariable long messageId) { social.delete(user(auth), id, messageId); }
    @PostMapping("/conversations/{id}/read") @ResponseStatus(HttpStatus.NO_CONTENT)
    void read(Authentication auth, @PathVariable UUID id, @Valid @RequestBody Read input) { social.read(user(auth), id, input.lastId()); }
    @GetMapping("/unread") SocialMessaging.Unread unread(Authentication auth) { return social.unread(user(auth)); }
    @GetMapping("/notifications") SocialMessaging.NoticePage notifications(Authentication auth, @RequestParam(defaultValue="0") int page,
            @RequestParam(defaultValue="false") boolean unreadOnly) { return social.notices(user(auth), page, unreadOnly); }
    @PostMapping("/notifications/{id}/read") @ResponseStatus(HttpStatus.NO_CONTENT)
    void seen(Authentication auth, @PathVariable UUID id) { social.seen(user(auth), id); }
    @PostMapping("/notifications/read-all") @ResponseStatus(HttpStatus.NO_CONTENT)
    void seenAll(Authentication auth) { social.seen(user(auth), null); }
    @GetMapping("/notification-preferences") SocialMessaging.Preferences preferences(Authentication auth) { return social.preferences(user(auth)); }
    @PutMapping("/notification-preferences") SocialMessaging.Preferences preferences(Authentication auth,
            @RequestBody SocialMessaging.Preferences input) { return social.preferences(user(auth), input); }
    private UUID user(Authentication auth) { return UUID.fromString(auth.getName()); }
}

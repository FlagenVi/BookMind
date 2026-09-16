package afoni.projectf.security;

import afoni.projectf.repository.UserAccountRepository;
import afoni.projectf.service.RememberedLoginService;
import afoni.projectf.service.UserSessionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class RememberedLoginFilter extends OncePerRequestFilter {
    private final RememberedLoginService remembered;
    private final UserAccountRepository users;
    private final UserSessionService sessions;
    private final SecurityContextRepository contexts;
    private final HttpSessionCsrfTokenRepository csrf;

    public RememberedLoginFilter(RememberedLoginService remembered, UserAccountRepository users,
                                 UserSessionService sessions, SecurityContextRepository contexts,
                                 HttpSessionCsrfTokenRepository csrf) {
        this.remembered = remembered;
        this.users = users;
        this.sessions = sessions;
        this.contexts = contexts;
        this.csrf = csrf;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            var login = remembered.find(request);
            if (login.isPresent()) {
                var account = users.findById(login.get().userId());
                if (account.isPresent()) {
                    var principal = User.withUsername(account.get().getId().toString())
                            .password("unavailable").roles("USER").build();
                    var authentication = UsernamePasswordAuthenticationToken.authenticated(
                            principal, null, principal.getAuthorities());
                    new ChangeSessionIdAuthenticationStrategy().onAuthentication(authentication, request, response);
                    new CsrfAuthenticationStrategy(csrf).onAuthentication(authentication, request, response);
                    var context = SecurityContextHolder.createEmptyContext();
                    context.setAuthentication(authentication);
                    SecurityContextHolder.setContext(context);
                    contexts.saveContext(context, request, response);
                    sessions.register(authentication, request);
                    remembered.bindSession(login.get().id(), request.getSession().getId());
                } else remembered.logout(request, response);
            } else if (request.getCookies() != null) {
                // A stale remembered cookie must not keep causing restore attempts.
                for (var cookie : request.getCookies())
                    if ("PROJECTF_REMEMBER".equals(cookie.getName())) {
                        remembered.clearCookie(request, response);
                        break;
                    }
            }
        }
        chain.doFilter(request, response);
    }
}

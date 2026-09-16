package afoni.projectf.security;

import afoni.projectf.repository.UserAccountRepository;
import afoni.projectf.service.RememberedLoginService;
import afoni.projectf.service.UserSessionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.core.session.SessionRegistryImpl;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.session.HttpSessionEventPublisher;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import java.util.Locale;

@Configuration
public class SecurityConfig {
    public static String normalizeEmail(String email) { return email.trim().toLowerCase(Locale.ROOT); }

    @Bean PasswordEncoder passwordEncoder() { return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8(); }

    @Bean UserDetailsService userDetailsService(UserAccountRepository users) {
        return email -> {
            var account = users.findByNormalizedEmail(normalizeEmail(email))
                    .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
            return User.withUsername(account.getId().toString()).password(account.getPasswordHash()).roles("USER").build();
        };
    }

    @Bean AuthenticationManager authenticationManager(UserDetailsService users, PasswordEncoder encoder) {
        var provider = new DaoAuthenticationProvider(users);
        provider.setPasswordEncoder(encoder);
        return new ProviderManager(provider);
    }

    @Bean SecurityContextRepository securityContextRepository() { return new HttpSessionSecurityContextRepository(); }
    @Bean HttpSessionCsrfTokenRepository csrfTokenRepository() { return new HttpSessionCsrfTokenRepository(); }
    @Bean SessionRegistry sessionRegistry() { return new SessionRegistryImpl(); }
    @Bean HttpSessionEventPublisher httpSessionEventPublisher() { return new HttpSessionEventPublisher(); }

    @Bean SecurityFilterChain security(HttpSecurity http, SecurityContextRepository contexts,
                                     HttpSessionCsrfTokenRepository csrf, SessionRegistry sessions,
                                     RememberedLoginService remembered, UserAccountRepository users,
                                     UserSessionService userSessions) throws Exception {
        return http
                .securityContext(config -> config.securityContextRepository(contexts))
                .csrf(config -> config.csrfTokenRepository(csrf))
                .headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()))
                .requestCache(config -> config.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login").permitAll()
                        // Legacy notes have no owner; do not expose them to newly registered users.
                        .requestMatchers("/api/notes", "/api/notes/**").denyAll()
                        .requestMatchers("/api/auth/me", "/api/auth/profile", "/api/auth/profile/**",
                                "/api/auth/sessions", "/api/auth/sessions/**", "/api/documents", "/api/documents/**",
                                "/api/books", "/api/books/**", "/api/reading", "/api/reading/**",
                                "/api/materials", "/api/materials/**").authenticated()
                        .requestMatchers("/api/book-uploads", "/api/book-uploads/**").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> response.setStatus(401))
                        .accessDeniedHandler((request, response, exception) -> response.setStatus(403)))
                .sessionManagement(session -> session.maximumSessions(-1).sessionRegistry(sessions)
                        .expiredSessionStrategy(event -> event.getResponse().setStatus(401)))
                .addFilterBefore(new RememberedLoginFilter(remembered, users, userSessions, contexts, csrf),
                        AnonymousAuthenticationFilter.class)
                .logout(logout -> logout.logoutUrl("/api/auth/logout")
                        .addLogoutHandler((request, response, auth) -> remembered.logout(request, response))
                        .invalidateHttpSession(true).clearAuthentication(true).deleteCookies("JSESSIONID")
                        .logoutSuccessHandler((request, response, auth) -> response.setStatus(204)))
                .build();
    }
}

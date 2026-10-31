package afoni.projectf.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

import static org.junit.jupiter.api.Assertions.*;

class BookImageResponseTests {
    @Test void uploadedSvgCannotOpenAsAnActiveSameOriginDocument() {
        var response = BookController.imageResponse(
                "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".getBytes(),
                "image/svg+xml");

        assertEquals("attachment", response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION));
        assertEquals("sandbox; default-src 'none'; style-src 'unsafe-inline'",
                response.getHeaders().getFirst("Content-Security-Policy"));
        assertEquals("nosniff", response.getHeaders().getFirst("X-Content-Type-Options"));
    }

    @Test void ordinaryBookIllustrationRemainsInline() {
        var response = BookController.imageResponse(new byte[]{1, 2, 3}, "image/png");

        assertNull(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION));
        assertArrayEquals(new byte[]{1, 2, 3}, response.getBody());
    }
}

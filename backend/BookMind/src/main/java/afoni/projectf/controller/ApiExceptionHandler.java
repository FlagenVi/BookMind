package afoni.projectf.controller;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {
    public record ErrorBody(String message) {}
    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<ErrorBody> authentication() { return error(HttpStatus.UNAUTHORIZED, "Неверный email или пароль"); }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ErrorBody> validation() { return error(HttpStatus.BAD_REQUEST, "Проверьте заполнение полей"); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ErrorBody> conflict() { return error(HttpStatus.CONFLICT, "Данные конфликтуют с существующей записью"); }
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<ErrorBody> tooLarge() { return error(HttpStatus.PAYLOAD_TOO_LARGE, "Файл слишком большой. Максимум — 10 МБ."); }
    @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
    ResponseEntity<ErrorBody> missingFile() { return error(HttpStatus.BAD_REQUEST, "Выберите файл TXT"); }
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ErrorBody> status(ResponseStatusException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(new ErrorBody(switch (ex.getStatusCode().value()) {
            case 404 -> "Документ не найден"; case 401 -> "Необходимо войти в аккаунт";
            case 409 -> ex.getReason() == null ? "Данные были изменены в другой вкладке" : ex.getReason();
            case 413 -> "Файл слишком большой. Максимум — 10 МБ.";
            case 400 -> ex.getReason() == null ? "Проверьте заполнение полей" : ex.getReason();
            default -> "Не удалось выполнить запрос";
        }));
    }
    private ResponseEntity<ErrorBody> error(HttpStatus status, String message) { return ResponseEntity.status(status).body(new ErrorBody(message)); }
}

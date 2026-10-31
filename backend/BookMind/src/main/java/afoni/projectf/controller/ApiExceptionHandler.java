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
    ResponseEntity<ErrorBody> tooLarge() { return error(HttpStatus.PAYLOAD_TOO_LARGE, "Файл слишком большой. Максимум — 30 МБ."); }
    @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
    ResponseEntity<ErrorBody> missingFile() { return error(HttpStatus.BAD_REQUEST, "Выберите файл"); }
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ErrorBody> status(ResponseStatusException ex) {
        // Reasons are written for users in the controllers; the defaults cover exceptions thrown without one.
        String message = ex.getReason() != null ? ex.getReason() : switch (ex.getStatusCode().value()) {
            case 404 -> "Не найдено"; case 401 -> "Необходимо войти в аккаунт";
            case 403 -> "Действие недоступно"; case 409 -> "Данные были изменены в другой вкладке";
            case 413 -> "Файл слишком большой. Максимум — 30 МБ.";
            case 429 -> "Слишком много запросов. Попробуйте чуть позже";
            case 400 -> "Проверьте заполнение полей";
            default -> "Не удалось выполнить запрос";
        };
        return ResponseEntity.status(ex.getStatusCode()).body(new ErrorBody(message));
    }
    private ResponseEntity<ErrorBody> error(HttpStatus status, String message) { return ResponseEntity.status(status).body(new ErrorBody(message)); }
}

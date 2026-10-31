package afoni.projectf.controller;

import afoni.projectf.model.Document;
import afoni.projectf.model.MaterialType;
import afoni.projectf.repository.DocumentRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/materials/{materialId}/contexts")
public class MaterialContextController {
    private final DocumentRepository documents;
    private final JdbcTemplate jdbc;

    public MaterialContextController(DocumentRepository documents,JdbcTemplate jdbc) {
        this.documents=documents;this.jdbc=jdbc;
    }

    record ContextInput(@Pattern(regexp="(?i)full_document|selected_sections|selected_fragment|read_to_position|current_chapter|whole_book") String mode,
                        @Size(max=200) String title,@Min(0) Integer startOffset,@Min(0) Integer endOffset,
                        @Size(max=200) List<@Min(-1) @Max(1000000) Integer> sectionNumbers,Boolean includeUnread) {}
    record ContextSummary(UUID id,String materialType,String mode,String title,int startOffset,int endOffset,
                          Integer positionOffset,Double progressPercent,List<Integer> sectionNumbers,int contentLength,
                          String sourceSha256,Instant sourceUpdatedAt,Instant createdAt) {}
    record ContextDetails(UUID id,String materialType,String mode,String title,int startOffset,int endOffset,
                          Integer positionOffset,Double progressPercent,List<Integer> sectionNumbers,int contentLength,String content,
                          String sourceSha256,Instant sourceUpdatedAt,Instant createdAt) {}
    private record Range(int start,int end,List<Integer> sections,String content) {}

    @GetMapping
    List<ContextSummary> list(Authentication auth,@PathVariable UUID materialId) {
        Document material=owned(auth,materialId);
        return jdbc.query("SELECT id,material_type,mode,title,start_offset,end_offset,position_offset,progress_percent,section_numbers,length(content_snapshot),source_sha256,source_updated_at,created_at FROM material_contexts WHERE user_id=? AND document_id=? ORDER BY created_at DESC,id",
                (rs,n)->new ContextSummary(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getString(4),rs.getInt(5),rs.getInt(6),
                        (Integer)rs.getObject(7),decimal(rs.getBigDecimal(8)),sections(rs.getString(9)),rs.getInt(10),rs.getString(11),
                        rs.getTimestamp(12).toInstant(),rs.getTimestamp(13).toInstant()),material.getUserId(),materialId);
    }

    @GetMapping("/{contextId}")
    ContextDetails get(Authentication auth,@PathVariable UUID materialId,@PathVariable UUID contextId) {
        Document material=owned(auth,materialId);
        return jdbc.query("SELECT id,material_type,mode,title,start_offset,end_offset,position_offset,progress_percent,section_numbers,content_snapshot,source_sha256,source_updated_at,created_at FROM material_contexts WHERE id=? AND user_id=? AND document_id=?",
                rs->{if(!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);return new ContextDetails(rs.getObject(1,UUID.class),rs.getString(2),rs.getString(3),rs.getString(4),rs.getInt(5),rs.getInt(6),
                        (Integer)rs.getObject(7),decimal(rs.getBigDecimal(8)),sections(rs.getString(9)),rs.getString(10).length(),rs.getString(10),rs.getString(11),rs.getTimestamp(12).toInstant(),rs.getTimestamp(13).toInstant());},
                contextId,material.getUserId(),materialId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    ContextDetails create(Authentication auth,@PathVariable UUID materialId,@Valid @RequestBody ContextInput input) {
        Document material=owned(auth,materialId);String mode=input.mode()==null?defaultMode(material):input.mode().toLowerCase(Locale.ROOT);
        validateMode(material.getMaterialType(),mode,input.includeUnread());
        int length=material.getOriginalText().length();
        Integer position=material.getMaterialType()==MaterialType.BOOK?confirmedPosition(material):null;
        Range range=range(material,mode,input,position,length);
        if(range.content().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выбранный контекст не содержит текста");
        Double progress=position==null?null:(length==0?0:Math.min(100,position*100.0/length));
        String title=input.title()==null || input.title().isBlank()?defaultTitle(mode):input.title().strip();
        String sourceHash=jdbc.query("SELECT original_sha256 FROM documents WHERE id=?",rs->rs.next()?rs.getString(1):null,materialId);
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO material_contexts(id,user_id,document_id,material_type,mode,title,start_offset,end_offset,position_offset,progress_percent,section_numbers,content_snapshot,source_sha256,source_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id,material.getUserId(),materialId,material.getMaterialType().name(),mode,title,range.start(),range.end(),position,progress,
                csv(range.sections()),range.content(),sourceHash,java.sql.Timestamp.from(material.getUpdatedAt()));
        return get(auth,materialId,id);
    }

    @DeleteMapping("/{contextId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth,@PathVariable UUID materialId,@PathVariable UUID contextId) {
        Document material=owned(auth,materialId);
        if(jdbc.update("DELETE FROM material_contexts WHERE id=? AND user_id=? AND document_id=?",contextId,material.getUserId(),materialId)!=1)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private Range range(Document material,String mode,ContextInput input,Integer position,int length) {
        if("full_document".equals(mode) || "whole_book".equals(mode)) return new Range(0,length,List.of(),material.getOriginalText());
        if("read_to_position".equals(mode)) {
            if(position==null || position<=0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"У книги ещё нет подтверждённого прочитанного фрагмента");
            return new Range(0,position,List.of(),material.getOriginalText().substring(0,position));
        }
        if("current_chapter".equals(mode)) {
            if(position==null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"У книги ещё нет сохранённой позиции");
            var rows=jdbc.query("SELECT section_number,start_offset,end_offset,content FROM reader_sections WHERE document_id=? AND start_offset<=? AND end_offset>=? ORDER BY section_number LIMIT 1",
                    (rs,n)->new Range(rs.getInt(2),rs.getInt(3),List.of(rs.getInt(1)),rs.getString(4)),material.getId(),position,position);
            if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Текущая глава не определена");
            return rows.getFirst();
        }
        if("selected_sections".equals(mode)) {
            var requested=new LinkedHashSet<>(Optional.ofNullable(input.sectionNumbers()).orElse(List.of()));
            if(requested.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Выберите хотя бы один раздел");
            String placeholders=String.join(",",Collections.nCopies(requested.size(),"?"));var args=new ArrayList<Object>();args.add(material.getId());args.addAll(requested);
            var rows=jdbc.query("SELECT section_number,start_offset,end_offset,title,content FROM reader_sections WHERE document_id=? AND section_number IN ("+placeholders+") ORDER BY section_number",
                    (rs,n)->new Object[]{rs.getInt(1),rs.getInt(2),rs.getInt(3),rs.getString(4),rs.getString(5)},args.toArray());
            if(rows.size()!=requested.size()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Один или несколько разделов не найдены");
            int start=(Integer)rows.getFirst()[1],end=(Integer)rows.getLast()[2];StringBuilder content=new StringBuilder();var selected=new ArrayList<Integer>();
            for(Object[] row:rows) {if(!content.isEmpty()) content.append("\n\n");content.append(row[3]).append("\n\n").append(row[4]);selected.add((Integer)row[0]);}
            return new Range(start,end,selected,content.toString());
        }
        int start=Optional.ofNullable(input.startOffset()).orElse(-1),end=Optional.ofNullable(input.endOffset()).orElse(-1);
        if(start<0 || end<=start || end>length) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Укажите корректные границы фрагмента");
        return new Range(start,end,List.of(),material.getOriginalText().substring(start,end));
    }

    private void validateMode(MaterialType type,String mode,Boolean includeUnread) {
        Set<String> allowed=type==MaterialType.BOOK
                ? Set.of("read_to_position","current_chapter","selected_sections","selected_fragment","whole_book")
                : Set.of("full_document","selected_sections","selected_fragment");
        if(!allowed.contains(mode)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Режим контекста не подходит для этого типа материала");
        if("whole_book".equals(mode) && !Boolean.TRUE.equals(includeUnread))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Для всей книги нужно явно разрешить использование непрочитанной части");
    }

    private Integer confirmedPosition(Document material) {
        return jdbc.query("SELECT confirmed_offset FROM reading_progress WHERE user_id=? AND document_id=?",
                rs->rs.next()?Math.min(material.getOriginalText().length(),rs.getInt(1)):0,material.getUserId(),material.getId());
    }
    private String defaultMode(Document material) { return material.getMaterialType()==MaterialType.BOOK?"read_to_position":"full_document"; }
    private String defaultTitle(String mode) { return switch(mode) {
        case "full_document" -> "Весь документ";case "selected_sections" -> "Выбранные разделы";case "selected_fragment" -> "Выбранный фрагмент";
        case "read_to_position" -> "До текущего места";case "current_chapter" -> "Текущая глава";case "whole_book" -> "Вся книга";default -> "Контекст";}; }
    private Document owned(Authentication auth,UUID id) {return documents.findByIdAndUserId(id,UUID.fromString(auth.getName())).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));}
    private Double decimal(BigDecimal value) {return value==null?null:value.doubleValue();}
    private String csv(List<Integer> values) {return values.isEmpty()?null:values.stream().map(String::valueOf).reduce((a,b)->a+","+b).orElse(null);}
    private List<Integer> sections(String value) {return value==null || value.isBlank()?List.of():Arrays.stream(value.split(",")).map(Integer::valueOf).toList();}
}

package afoni.projectf.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@Service
public class ReaderStructureService {
    private final JdbcTemplate jdbc;
    private final BookTextExtractor extractor;
    public ReaderStructureService(JdbcTemplate jdbc,BookTextExtractor extractor) { this.jdbc=jdbc;this.extractor=extractor; }

    @Transactional
    public void save(UUID documentId,BookTextExtractor.ExtractedBook book) {
        jdbc.update("DELETE FROM reader_sections WHERE document_id=?",documentId);
        jdbc.update("DELETE FROM reader_toc_entries WHERE document_id=?",documentId);
        jdbc.update("DELETE FROM book_assets WHERE document_id=?",documentId);
        jdbc.update("DELETE FROM book_genres WHERE document_id=?",documentId);
        jdbc.update("UPDATE documents SET author=?,publisher=?,publication_date=?,language=?,description=? WHERE id=?",
                clean(book.author(),500),clean(book.publisher(),500),clean(book.publicationDate(),255),
                clean(book.language(),100),clean(book.description(),50_000),documentId);
        for(String genre:book.genres()) jdbc.update("INSERT INTO book_genres(document_id,genre) VALUES (?,?)",documentId,genre);
        Map<String,UUID> assets=new HashMap<>();
        for(var asset:book.assets()) {
            UUID id=UUID.randomUUID(); assets.put(asset.sourcePath(),id);
            jdbc.update("INSERT INTO book_assets(id,document_id,source_path,media_type,content,is_cover) VALUES (?,?,?,?,?,?)",
                    id,documentId,asset.sourcePath(),asset.mediaType(),asset.content(),asset.cover());
        }
        int cursor=0;
        for(int number=0;number<book.sections().size();number++) {
            var section=book.sections().get(number);
            if(number>0) cursor+=2;
            int start=cursor,end=start+section.text().length(); cursor=end;
            jdbc.update("INSERT INTO reader_sections(document_id,section_number,title,role,source_path,start_offset,end_offset,content,toc_level) VALUES (?,?,?,?,?,?,?,?,?)",
                    documentId,number,section.title(),section.role(),section.sourcePath(),start,end,section.text(),section.tocLevel());
            int order=0;
            for(String path:section.assetPaths()) {
                UUID assetId=assets.get(path);
                if(assetId!=null) jdbc.update("INSERT INTO reader_section_assets(document_id,section_number,asset_id,order_index) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
                        documentId,number,assetId,order++);
            }
        }
        for(int number=0;number<book.toc().size();number++) {
            var entry=book.toc().get(number);
            jdbc.update("INSERT INTO reader_toc_entries(document_id,entry_number,title,role,toc_level,position_offset) VALUES (?,?,?,?,?,?)",
                    documentId,number,entry.title(),entry.role(),entry.level(),entry.positionOffset());
        }
        var linkNumbers=new HashMap<Integer,Integer>();
        for(var link:book.links()) {
            int linkNumber=linkNumbers.getOrDefault(link.sectionNumber(),0);linkNumbers.put(link.sectionNumber(),linkNumber+1);
            jdbc.update("INSERT INTO reader_section_links(document_id,section_number,link_number,start_offset,end_offset,target_section_number,target_section_offset,target_position_offset,kind) VALUES (?,?,?,?,?,?,?,?,?)",
                    documentId,link.sectionNumber(),linkNumber,link.startOffset(),link.endOffset(),link.targetSectionNumber(),
                    link.targetSectionOffset(),link.targetPositionOffset(),link.kind());
        }
        jdbc.update("UPDATE documents SET reader_structure_version=4 WHERE id=?",documentId);
    }
    @Transactional
    public synchronized void ensure(UUID documentId,String format) {
        Integer count=jdbc.queryForObject("SELECT count(*) FROM reader_sections WHERE document_id=?",Integer.class,documentId);
        Integer version=jdbc.queryForObject("SELECT reader_structure_version FROM documents WHERE id=?",Integer.class,documentId);
        int requiredVersion="epub".equals(format)?4:2;
        if((count!=null && count>0 && (version==null || version>=requiredVersion)) || !Set.of("epub","fb2").contains(format)) return;
        var files=jdbc.query("SELECT original_file FROM documents WHERE id=?",(rs,n)->rs.getBytes(1),documentId);
        if(files.isEmpty() || files.getFirst()==null) return;
        try { save(documentId,extractor.extractBook(files.getFirst(),format)); }
        catch(ResponseStatusException ignored) { /* Legacy text remains readable when its original cannot be reconstructed. */ }
    }
    @Transactional
    public boolean refreshDetails(UUID documentId,BookTextExtractor.ExtractedBook book) {
        String publisher=clean(book.publisher(),500),publicationDate=clean(book.publicationDate(),255);
        String language=clean(book.language(),100),description=clean(book.description(),50_000);
        if(publisher==null && publicationDate==null && language==null && description==null) return false;
        jdbc.update("UPDATE documents SET publisher=COALESCE(?,publisher),publication_date=COALESCE(?,publication_date),"+
                        "language=COALESCE(?,language),description=COALESCE(?,description) WHERE id=?",
                publisher,publicationDate,language,description,documentId);
        return true;
    }
    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void refreshOutdatedEpubStructures() {
        var ids=jdbc.query("SELECT id FROM documents WHERE source_type='epub' AND reader_structure_version<4 ORDER BY created_at",
                (rs,n)->rs.getObject(1,UUID.class));
        for(UUID id:ids) ensure(id,"epub");
    }
    private String clean(String value,int max) { if(value==null || value.isBlank()) return null;String clean=value.strip();return clean.length()<=max?clean:clean.substring(0,max); }
}

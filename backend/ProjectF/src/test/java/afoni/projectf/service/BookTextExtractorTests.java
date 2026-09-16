package afoni.projectf.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.charset.Charset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Base64;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;

public class BookTextExtractorTests {
    private final BookTextExtractor extractor=new BookTextExtractor();

    public static byte[] fb2() {
        return ("<?xml version='1.0' encoding='windows-1251'?><FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><book-title>Метаданные</book-title></title-info></description><body><section><title><p>Первая</p></title><p>Привет <emphasis>мир</emphasis>!</p></section></body><binary>Обложка</binary></FictionBook>").getBytes(Charset.forName("windows-1251"));
    }
    public static Map<String,String> entries() {
        var entries=new LinkedHashMap<String,String>();
        entries.put("mimetype","application/epub+zip");
        entries.put("META-INF/container.xml","<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OPS/book.opf'/></rootfiles></container>");
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='one' href='chapters/one%20chapter.xhtml' media-type='application/xhtml+xml'/><item id='two' href='chapters/two.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='one'/><itemref idref='two'/></spine></package>");
        entries.put("OPS/chapters/two.xhtml","<html><body><h1>Вторая</h1><p>Финал.</p></body></html>");
        entries.put("OPS/chapters/one chapter.xhtml","<html><body><nav>Навигация</nav><h1>Первая</h1><p>Привет <em>мир</em>! 😀</p><script>Скрипт</script></body></html>");
        return entries;
    }
    public static Map<String,String> linkedEntries() {
        var entries=entries();
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='one' href='chapters/one.xhtml' media-type='application/xhtml+xml'/><item id='two' href='chapters/two.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='one'/><itemref idref='two'/></spine></package>");
        entries.remove("OPS/chapters/one chapter.xhtml");
        entries.put("OPS/chapters/one.xhtml","<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'><body><p><a href='#local'>Внутри</a> <a href='two.xhtml'>Другая глава</a> <a href='two.xhtml#target'>Фрагмент</a> <a epub:type='noteref' href='two.xhtml#note'>1</a> <a href='https://example.test/page'>Внешняя</a> <a href='javascript:alert(1)'>JS</a> <a href='data:text/plain,no'>Data</a></p><p id='local'>Локальная цель.</p></body></html>");
        entries.put("OPS/chapters/two.xhtml","<html xmlns='http://www.w3.org/1999/xhtml'><body><p>Начало второй главы.</p><p id='target'>Целевой фрагмент.</p><aside id='note'>Текст примечания.</aside></body></html>");
        return entries;
    }
    public static byte[] epub(Map<String,String> entries) throws Exception {
        var bytes=new ByteArrayOutputStream();
        try(var zip=new ZipOutputStream(bytes)) {
            for(var entry:entries.entrySet()) { zip.putNextEntry(new ZipEntry(entry.getKey()));zip.write(entry.getValue().getBytes(StandardCharsets.UTF_8));zip.closeEntry(); }
        }
        return bytes.toByteArray();
    }
    @Test void fb2RespectsEncodingAndSkipsMetadata() {
        String text=extractor.extract(fb2(),"fb2");
        assertTrue(text.contains("Глава: Первая"));assertTrue(text.contains("Привет мир!"));
        assertFalse(text.contains("Метаданные"));assertFalse(text.contains("Обложка"));
    }
    @Test void xhtmlSelfClosingTitleAndNestedBlocksDoNotLoseText() throws Exception {
        var entries=entries();
        entries.put("OPS/chapters/one chapter.xhtml","<?xml version='1.0' encoding='UTF-8'?><html xmlns='http://www.w3.org/1999/xhtml'><head><title/></head><body><span><p>Начало главы.</p><p class='empty-line'/><div class='title'><p>Вложенный заголовок</p></div><p>Середина главы.</p></span><p>Конец главы.</p></body></html>");
        String text=extractor.extract(epub(entries),"epub");
        assertTrue(text.contains("Начало главы."));
        assertTrue(text.contains("Вложенный заголовок"));
        assertTrue(text.contains("Середина главы."));
        assertTrue(text.contains("Конец главы."));
        assertTrue(text.contains("Начало главы.\n"));
        assertTrue(text.indexOf("Начало главы.")<text.indexOf("Середина главы."));
        assertTrue(text.indexOf("Конец главы.")<text.indexOf("Финал."));
    }
    @Test void epubUsesSpineOrderAndDecodedRelativePaths() throws Exception {
        String text=extractor.extract(epub(entries()),"epub");
        assertTrue(text.indexOf("Первая")<text.indexOf("Вторая"));assertTrue(text.contains("Привет мир! 😀"));
        assertFalse(text.contains("Навигация"));assertFalse(text.contains("Скрипт"));
    }
    @Test void epubExtractsMetadataTocCoverAndSectionImages() throws Exception {
        var entries=entries();
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf' xmlns:dc='http://purl.org/dc/elements/1.1/'><metadata><dc:title>Книга из EPUB</dc:title><dc:creator>Автор Книги</dc:creator><dc:subject>Фантастика</dc:subject><dc:publisher>Издательство</dc:publisher><dc:date>1866</dc:date><dc:language>ru</dc:language><dc:description>Описание книги</dc:description></metadata><manifest><item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/><item id='cover' href='images/cover.png' media-type='image/png' properties='cover-image'/><item id='one' href='chapters/one%20chapter.xhtml' media-type='application/xhtml+xml'/><item id='two' href='chapters/two.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='one'/><itemref idref='two' linear='no'/></spine></package>");
        entries.put("OPS/nav.xhtml","<html><body><nav><a href='chapters/one%20chapter.xhtml'>Начало из оглавления</a></nav></body></html>");
        entries.put("OPS/images/cover.png","fake-image");
        entries.put("OPS/chapters/one chapter.xhtml","<html><body><img src='../images/cover.png'/><p>Первая глава.</p></body></html>");
        var book=extractor.extractBook(epub(entries),"epub");
        assertEquals("Книга из EPUB",book.suggestedTitle());assertEquals("Автор Книги",book.author());
        assertEquals(List.of("Фантастика"),book.genres());
        assertEquals("Издательство",book.publisher());assertEquals("1866",book.publicationDate());
        assertEquals("ru",book.language());assertEquals("Описание книги",book.description());
        assertEquals("Начало из оглавления",book.sections().getFirst().title());
        assertEquals("auxiliary",book.sections().get(1).role());
        assertEquals(List.of("OPS/images/cover.png"),book.sections().getFirst().assetPaths());
        assertEquals(1,book.assets().size());assertTrue(book.assets().getFirst().cover());
    }
    @Test void epubTwoNcxProvidesTitlesAndHierarchy() throws Exception {
        var entries=entries();
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/><item id='one' href='chapters/one%20chapter.xhtml' media-type='application/xhtml+xml'/><item id='two' href='chapters/two.xhtml' media-type='application/xhtml+xml'/></manifest><spine toc='ncx'><itemref idref='one'/><itemref idref='two'/></spine></package>");
        entries.put("OPS/toc.ncx","<ncx xmlns='http://www.daisy.org/z3986/2005/ncx/'><navMap><navPoint><navLabel><text>Часть первая</text></navLabel><content src='chapters/one%20chapter.xhtml'/><navPoint><navLabel><text>Глава I</text></navLabel><content src='chapters/two.xhtml#one'/></navPoint><navPoint><navLabel><text>Глава II</text></navLabel><content src='chapters/two.xhtml#two'/></navPoint></navPoint></navMap></ncx>");
        entries.put("OPS/chapters/two.xhtml","<html><body><h1 id='one'>Глава I</h1><p>Начало.</p><h1 id='two'>Глава II</h1><p>Продолжение.</p></body></html>");
        var book=extractor.extractBook(epub(entries),"epub");
        assertEquals(List.of("Часть первая","Глава I"),book.sections().stream().map(BookTextExtractor.SectionData::title).toList());
        assertEquals(List.of(0,1),book.sections().stream().map(BookTextExtractor.SectionData::tocLevel).toList());
        assertEquals(List.of("Часть первая","Глава I","Глава II"),book.toc().stream().map(BookTextExtractor.TocData::title).toList());
        assertEquals(List.of(0,1,1),book.toc().stream().map(BookTextExtractor.TocData::level).toList());
        assertTrue(book.toc().get(2).positionOffset()>book.toc().get(1).positionOffset());
    }
    @Test void epubNavigationKeepsDistinctChaptersInsideOneXhtml() throws Exception {
        var entries=entries();
        entries.put("OPS/book.opf","<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/><item id='one' href='chapters/all.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='one'/></spine></package>");
        entries.remove("OPS/chapters/one chapter.xhtml");entries.remove("OPS/chapters/two.xhtml");
        entries.put("OPS/nav.xhtml","<html xmlns='http://www.w3.org/1999/xhtml'><body><nav><ol><li><a href='chapters/all.xhtml#one'>Глава I</a></li><li><a href='chapters/all.xhtml#two'>Глава II</a></li><li><a href='chapters/all.xhtml#three'>Глава III</a></li></ol></nav></body></html>");
        entries.put("OPS/chapters/all.xhtml","<html xmlns='http://www.w3.org/1999/xhtml'><body><h1 id='one'>Глава I</h1><p>Первый текст.</p><h1 id='two'>Глава II</h1><p>Второй текст.</p><section id='three'><h1>Глава III</h1><p>Третий текст.</p></section></body></html>");
        var book=extractor.extractBook(epub(entries),"epub");
        assertEquals(1,book.sections().size());
        assertEquals(List.of("Глава I","Глава II","Глава III"),book.toc().stream().map(BookTextExtractor.TocData::title).toList());
        assertTrue(book.toc().get(0).positionOffset()<book.toc().get(1).positionOffset());
        assertTrue(book.toc().get(1).positionOffset()<book.toc().get(2).positionOffset());
        assertEquals(book.text().indexOf("Глава: Глава II"),book.toc().get(1).positionOffset());
        assertEquals(book.text().indexOf("Глава: Глава III"),book.toc().get(2).positionOffset());
    }
    @Test void epubResolvesInternalLinksAndIgnoresExternalTargets() throws Exception {
        var book=extractor.extractBook(epub(linkedEntries()),"epub");
        assertEquals(4,book.links().size());
        var same=book.links().get(0);var other=book.links().get(1);var fragment=book.links().get(2);var note=book.links().get(3);
        assertEquals("Внутри",book.sections().getFirst().text().substring(same.startOffset(),same.endOffset()));
        assertEquals(0,same.sectionNumber());assertEquals(0,same.targetSectionNumber());
        assertEquals(book.sections().getFirst().anchorOffsets().get("local").intValue(),same.targetSectionOffset());
        assertEquals(1,other.targetSectionNumber());assertEquals(0,other.targetSectionOffset());
        assertEquals(1,fragment.targetSectionNumber());
        assertEquals(book.sections().get(1).anchorOffsets().get("target").intValue(),fragment.targetSectionOffset());
        assertEquals(book.sections().getFirst().text().length()+2+fragment.targetSectionOffset(),fragment.targetPositionOffset());
        assertEquals("note",note.kind());assertEquals(book.sections().get(1).anchorOffsets().get("note").intValue(),note.targetSectionOffset());
        assertTrue(book.links().stream().limit(3).allMatch(link->"internal".equals(link.kind())));
    }
    @Test void fb2ExtractsAuthorCoverAndRealSections() {
        String xml="<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0' xmlns:l='http://www.w3.org/1999/xlink'><description><title-info><genre>science_fiction</genre><book-title>FB2 книга</book-title><author><first-name>Иван</first-name><last-name>Иванов</last-name></author><annotation><p>Первый   абзац.</p><p>Второй абзац.</p></annotation><date value='2007-01-01'>2007</date><lang>ru</lang><coverpage><image l:href='#cover.jpg'/></coverpage></title-info><publish-info><publisher>Издательство АСТ</publisher><year>2018</year></publish-info></description><body><section><title><p>Глава один</p></title><p>Текст.</p><image l:href='#cover.jpg'/></section></body><binary id='cover.jpg' content-type='image/jpeg'>YWJj</binary></FictionBook>";
        var book=extractor.extractBook(xml.getBytes(StandardCharsets.UTF_8),"fb2");
        assertEquals("FB2 книга",book.suggestedTitle());assertEquals("Иван Иванов",book.author());
        assertEquals(List.of("science_fiction"),book.genres());
        assertEquals("Издательство АСТ",book.publisher());assertEquals("2007-01-01",book.publicationDate());
        assertEquals("ru",book.language());assertEquals("Первый абзац.\n\nВторой абзац.",book.description());
        assertEquals(1,book.sections().size());assertEquals("Глава один",book.sections().getFirst().title());
        assertEquals(List.of("cover.jpg"),book.sections().getFirst().assetPaths());assertTrue(book.assets().getFirst().cover());
    }
    @Test void fb2PublicationDateUsesValueThenDisplayedDateAndPublishYear() {
        String valueDate="<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><date value='2007-01-01'>2007</date></title-info></description><body><section><p>Текст.</p></section></body></FictionBook>";
        assertEquals("2007-01-01",extractor.extractBook(valueDate.getBytes(StandardCharsets.UTF_8),"fb2").publicationDate());
        String textDate=valueDate.replace(" value='2007-01-01'","");
        assertEquals("2007",extractor.extractBook(textDate.getBytes(StandardCharsets.UTF_8),"fb2").publicationDate());
        String publishYear=valueDate.replace("<date value='2007-01-01'>2007</date>","").replace("</description>","<publish-info><year>2018</year></publish-info></description>");
        assertEquals("2018",extractor.extractBook(publishYear.getBytes(StandardCharsets.UTF_8),"fb2").publicationDate());
    }
    @Test void fb2NestedSectionsBecomeSeparateTocChapters() {
        String xml="<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><book-title>Книга</book-title></title-info></description><body><section><title><p>Часть первая</p></title><section><title><p>Глава I</p></title><p>Первая глава.</p></section><section><title><p>Глава II</p></title><p>Вторая глава.</p></section></section></body></FictionBook>";
        var book=extractor.extractBook(xml.getBytes(StandardCharsets.UTF_8),"fb2");
        assertEquals(2,book.sections().size());
        assertEquals(List.of("Глава I","Глава II"),book.sections().stream().map(BookTextExtractor.SectionData::title).toList());
        assertTrue(book.sections().getFirst().text().contains("Первая глава."));
        assertFalse(book.sections().getFirst().text().contains("Вторая глава."));
    }
    @Test void rejectsMalformedEmptyAndExternalEntities() {
        for(String xml:new String[]{"broken","<FictionBook/>","<!DOCTYPE FictionBook [<!ENTITY x SYSTEM 'file:///nonexistent'>]><FictionBook><body><p>&x;</p></body></FictionBook>","<FictionBook>"+"<section>".repeat(200)+"</section>".repeat(200)+"</FictionBook>"})
            assertThrows(ResponseStatusException.class,()->extractor.extract(xml.getBytes(StandardCharsets.UTF_8),"fb2"));
        assertThrows(ResponseStatusException.class,()->extractor.extract(new byte[]{1,2,3},"epub"));
    }
    @Test void rejectsMissingChaptersTraversalAndOversizedExpansion() throws Exception {
        var missing=entries();missing.remove("OPS/chapters/two.xhtml");
        byte[] archive=epub(missing);assertThrows(ResponseStatusException.class,()->extractor.extract(archive,"epub"));
        var traversal=entries();traversal.put("../outside","text");
        byte[] unsafe=epub(traversal);assertThrows(ResponseStatusException.class,()->extractor.extract(unsafe,"epub"));
        var large=entries();large.put("large.bin","x".repeat(10*1024*1024+1));
        byte[] bomb=epub(large);assertThrows(ResponseStatusException.class,()->extractor.extract(bomb,"epub"));
    }
    @Test void rejectsDrm() throws Exception {
        var entries=entries();entries.put("META-INF/encryption.xml","<encryption><EncryptionMethod Algorithm='encrypted'/></encryption>");
        byte[] archive=epub(entries);assertThrows(ResponseStatusException.class,()->extractor.extract(archive,"epub"));
    }
    @Test void extractsPdfByPages() throws Exception {
        byte[] bytes;
        try(var document=new org.apache.pdfbox.pdmodel.PDDocument(); var output=new ByteArrayOutputStream()) {
            var page=new org.apache.pdfbox.pdmodel.PDPage(); document.addPage(page);
            try(var stream=new org.apache.pdfbox.pdmodel.PDPageContentStream(document,page)) {
                stream.beginText(); stream.setFont(new org.apache.pdfbox.pdmodel.font.PDType1Font(org.apache.pdfbox.pdmodel.font.Standard14Fonts.FontName.HELVETICA),12);
                stream.newLineAtOffset(50,700); stream.showText("Reader PDF text"); stream.endText();
            }
            document.save(output); bytes=output.toByteArray();
        }
        String text=extractor.extract(bytes,"pdf");
        assertTrue(text.contains("Страница 1"));assertTrue(text.contains("Reader PDF text"));
    }
    @Test void reportsPdfWithoutTextLayerForLaterOcr() throws Exception {
        byte[] bytes;
        try(var document=new org.apache.pdfbox.pdmodel.PDDocument(); var output=new ByteArrayOutputStream()) {
            document.addPage(new org.apache.pdfbox.pdmodel.PDPage());
            document.save(output);bytes=output.toByteArray();
        }
        var book=extractor.extractBook(bytes,"pdf");
        assertEquals(1,book.sections().size());
        assertTrue(book.diagnostics().metadataWarnings().stream().anyMatch(value->value.contains("текстового слоя")));
    }
    @Test void extractsDocxParagraphs() throws Exception {
        byte[] bytes;
        try(var document=new org.apache.poi.xwpf.usermodel.XWPFDocument(); var output=new ByteArrayOutputStream()) {
            document.createParagraph().createRun().setText("Текст документа DOCX");
            document.write(output); bytes=output.toByteArray();
        }
        assertTrue(extractor.extract(bytes,"docx").contains("Текст документа DOCX"));
    }
    @Test void docxHeadingsImagesListsAndTablesKeepStructure() throws Exception {
        byte[] bytes;
        try(var document=new org.apache.poi.xwpf.usermodel.XWPFDocument(); var output=new ByteArrayOutputStream()) {
            var first=document.createParagraph();first.setStyle("Heading1");first.createRun().setText("Первая глава");
            document.createParagraph().createRun().setText("Обычный абзац");
            var second=document.createParagraph();second.setStyle("Heading2");second.createRun().setText("Подраздел");
            var list=document.createParagraph();list.setNumID(java.math.BigInteger.ONE);list.createRun().setText("Пункт списка");
            var table=document.createTable(2,2);
            table.getRow(0).getCell(0).setText("Колонка A");table.getRow(0).getCell(1).setText("Колонка B");
            table.getRow(1).getCell(0).setText("Значение 1");table.getRow(1).getCell(1).setText("Значение 2");
            byte[] png=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
            var image=document.createParagraph().createRun();
            image.addPicture(new java.io.ByteArrayInputStream(png),org.apache.poi.xwpf.usermodel.Document.PICTURE_TYPE_PNG,
                    "pixel.png",org.apache.poi.util.Units.toEMU(10),org.apache.poi.util.Units.toEMU(10));
            document.write(output);bytes=output.toByteArray();
        }
        var book=extractor.extractBook(bytes,"docx");
        assertEquals(List.of("Первая глава","Подраздел"),book.sections().stream().map(BookTextExtractor.SectionData::title).toList());
        assertEquals(List.of(0,1),book.toc().stream().map(BookTextExtractor.TocData::level).toList());
        assertTrue(book.text().contains("• Пункт списка"));
        assertTrue(book.text().contains("| Колонка A | Колонка B |"));
        assertEquals(1,book.assets().size());
        assertTrue(book.sections().get(1).assetPaths().stream().anyMatch(path->path.endsWith("image1.png")));
    }
    @Test void extractsMarkdownHeadingsAsSections() {
        String markdown="# Введение\n\nПервый абзац.\n\n## Детали\n\nВторой абзац.";
        var book=extractor.extractBook(markdown.getBytes(StandardCharsets.UTF_8),"md");
        assertEquals("Введение",book.suggestedTitle());
        assertEquals(List.of("Введение","Детали"),book.sections().stream().map(BookTextExtractor.SectionData::title).toList());
        assertEquals(List.of(0,1),book.sections().stream().map(BookTextExtractor.SectionData::tocLevel).toList());
        assertTrue(book.text().contains("Второй абзац."));
    }
}

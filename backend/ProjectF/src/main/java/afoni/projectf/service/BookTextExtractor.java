package afoni.projectf.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.*;
import org.xml.sax.*;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.*;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.zip.*;

@Service
public class BookTextExtractor {
    private static final int MAX_TEXT=12_000_000, MAX_ENTRY=10*1024*1024, MAX_ARCHIVE=100*1024*1024;

    public record SectionData(String title,String text,String role,String sourcePath,List<String> assetPaths,int tocLevel,Map<String,Integer> anchorOffsets) {
        public SectionData(String title,String text,String role,String sourcePath,List<String> assetPaths) { this(title,text,role,sourcePath,assetPaths,0,Map.of()); }
        public SectionData(String title,String text,String role,String sourcePath,List<String> assetPaths,int tocLevel) { this(title,text,role,sourcePath,assetPaths,tocLevel,Map.of()); }
        public SectionData { assetPaths=List.copyOf(assetPaths);anchorOffsets=Map.copyOf(anchorOffsets); }
    }
    public record AssetData(String sourcePath,String mediaType,byte[] content,boolean cover) {}
    public record TocData(String title,String role,int level,int positionOffset) {}
    public record ExtractedBook(String text,String suggestedTitle,String author,List<String> genres,List<SectionData> sections,List<TocData> toc,List<AssetData> assets) {
        public ExtractedBook { genres=List.copyOf(genres);sections=List.copyOf(sections);toc=List.copyOf(toc);assets=List.copyOf(assets); }
    }
    private record ManifestItem(String id,String path,String mediaType,String properties) {}
    private record TocSource(String title,int level,String path,String fragment) {}

    public String extract(byte[] bytes,String format) { return extractBook(bytes,format).text(); }

    public ExtractedBook extractBook(byte[] bytes,String format) {
        try {
            ExtractedBook book=switch(format) {
                case "txt" -> txt(bytes);
                case "fb2" -> fb2(bytes);
                case "epub" -> epub(bytes);
                case "pdf" -> pdf(bytes);
                case "docx" -> docx(bytes);
                default -> throw bad("Поддерживаются TXT, EPUB, FB2, PDF и DOCX");
            };
            String text=book.text();
            if(text.startsWith("\uFEFF")) text=text.substring(1);
            if(text.isBlank() || text.indexOf('\0')>=0) throw bad("Книга не содержит доступного текста или содержит недопустимые символы");
            if(text.length()>MAX_TEXT) throw bad("Максимум — 12 000 000 символов извлечённого текста");
            if(!text.equals(book.text())) return new ExtractedBook(text,book.suggestedTitle(),book.author(),book.genres(),book.sections(),book.toc(),book.assets());
            return book;
        } catch(ResponseStatusException error) { throw error; }
        catch(CharacterCodingException error) { throw bad("Сохраните TXT в кодировке UTF-8"); }
        catch(Exception error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Не удалось прочитать книгу: файл повреждён или имеет неподдерживаемую структуру",error); }
    }

    private ExtractedBook txt(byte[] bytes) throws CharacterCodingException {
        String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        if(text.startsWith("\uFEFF")) text=text.substring(1);
        return book(null,null,List.of(new SectionData("Текст",text,"main",null,List.of())),List.of());
    }

    private ExtractedBook pdf(byte[] bytes) throws Exception {
        try(var document=org.apache.pdfbox.Loader.loadPDF(bytes)) {
            if(document.isEncrypted()) throw bad("Защищённый PDF не поддерживается");
            var stripper=new org.apache.pdfbox.text.PDFTextStripper();stripper.setSortByPosition(true);
            var sections=new ArrayList<SectionData>();
            for(int page=1;page<=document.getNumberOfPages();page++) {
                stripper.setStartPage(page);stripper.setEndPage(page);
                String text=("Страница "+page+"\n\n"+stripper.getText(document)).strip();
                sections.add(new SectionData("Страница "+page,text,"main","page:"+page,List.of()));
            }
            return book(null,null,sections,List.of());
        }
    }

    private ExtractedBook docx(byte[] bytes) throws Exception {
        try(var document=new org.apache.poi.xwpf.usermodel.XWPFDocument(new ByteArrayInputStream(bytes));
            var extractor=new org.apache.poi.xwpf.extractor.XWPFWordExtractor(document)) {
            String text=extractor.getText().strip();
            return book(null,null,List.of(new SectionData("Документ",text,"main",null,List.of())),List.of());
        }
    }

    private ExtractedBook fb2(byte[] bytes) throws Exception {
        var document=xml(bytes);var root=document.getDocumentElement();
        if(!"FictionBook".equals(root.getLocalName())) throw bad("Некорректная структура FB2");
        String title=firstText(root,"book-title");
        var genres=texts(root,"genre");
        String author=null;
        var authors=root.getElementsByTagNameNS("*","author");
        if(authors.getLength()>0) {
            var parts=new ArrayList<String>();Element value=(Element)authors.item(0);
            for(String name:List.of("first-name","middle-name","last-name")) { String part=firstText(value,name);if(part!=null) parts.add(part); }
            author=String.join(" ",parts);
        }
        String coverId=null;var covers=root.getElementsByTagNameNS("*","coverpage");
        if(covers.getLength()>0) {
            var images=((Element)covers.item(0)).getElementsByTagNameNS("*","image");
            if(images.getLength()>0) coverId=href((Element)images.item(0));
        }
        var assets=new ArrayList<AssetData>();var binaries=root.getElementsByTagNameNS("*","binary");
        for(int i=0;i<binaries.getLength();i++) {
            Element binary=(Element)binaries.item(i);String id=binary.getAttribute("id"),media=binary.getAttribute("content-type");
            if(id.isBlank() || !media.startsWith("image/")) continue;
            byte[] content=Base64.getMimeDecoder().decode(binary.getTextContent());
            if(content.length>MAX_ENTRY) throw bad("Изображение FB2 слишком велико");
            assets.add(new AssetData(id,media,content,id.equals(coverId)));
        }
        var sections=new ArrayList<SectionData>();var bodies=directChildren(root,"body");int bodyNumber=0;
        for(Element body:bodies) {
            String role=bodyNumber++==0?"main":"auxiliary";var bodySections=directChildren(body,"section");
            if(bodySections.isEmpty()) addFbSection(sections,body,role,"body:"+bodyNumber);
            else for(int i=0;i<bodySections.size();i++) addFbSections(sections,bodySections.get(i),role,"body:"+bodyNumber+"/section:"+(i+1));
        }
        return book(title,author,genres,sections,assets);
    }

    private void addFbSections(List<SectionData> sections,Element element,String role,String path) {
        var nested=directChildren(element,"section");
        if(nested.isEmpty()) { addFbSection(sections,element,role,path);return; }
        if(hasOwnFbContent(element)) addFbOwnSection(sections,element,role,path);
        for(int i=0;i<nested.size();i++) addFbSections(sections,nested.get(i),role,path+"/section:"+(i+1));
    }

    private boolean hasOwnFbContent(Element element) {
        for(Node child=element.getFirstChild();child!=null;child=child.getNextSibling()) {
            if(child.getNodeType()==Node.TEXT_NODE && !child.getNodeValue().isBlank()) return true;
            if(child instanceof Element value && !Set.of("title","section","image").contains(value.getLocalName()) && clean(value.getTextContent())!=null) return true;
        }
        return false;
    }

    private void addFbOwnSection(List<SectionData> sections,Element element,String role,String path) {
        String title=sectionTitle(element,"Раздел "+(sections.size()+1));var text=new StringBuilder();renderFbOwn(element,text,0,true);
        String value=text.toString().strip();if(!value.isBlank()) sections.add(new SectionData(limit(title,500),value,role,path,List.of()));
    }

    private void addFbSection(List<SectionData> sections,Element element,String role,String path) {
        String title=sectionTitle(element,"Раздел "+(sections.size()+1));var text=new StringBuilder();renderFb(element,text,0);
        var assetPaths=new ArrayList<String>();var images=element.getElementsByTagNameNS("*","image");
        for(int i=0;i<images.getLength();i++) { String value=href((Element)images.item(i));if(value!=null && !assetPaths.contains(value)) assetPaths.add(value); }
        String value=text.toString().strip();if(!value.isBlank()) sections.add(new SectionData(limit(title,500),value,role,path,assetPaths));
    }

    private ExtractedBook epub(byte[] bytes) throws Exception {
        Map<String,byte[]> entries=zipEntries(bytes);byte[] container=required(entries,"META-INF/container.xml");checkEncryption(entries);
        var roots=xml(container).getElementsByTagNameNS("*","rootfile");if(roots.getLength()==0) throw bad("В EPUB отсутствует описание книги");
        String opf=path(((Element)roots.item(0)).getAttribute("full-path"));var packageXml=xml(required(entries,opf));
        String title=firstText(packageXml.getDocumentElement(),"title");var creators=packageXml.getElementsByTagNameNS("*","creator");
        String author=creators.getLength()>0?clean(creators.item(0).getTextContent()):null;
        var genres=texts(packageXml.getDocumentElement(),"subject");
        String legacyCoverId=null;var metadata=packageXml.getElementsByTagNameNS("*","meta");
        for(int i=0;i<metadata.getLength();i++) { Element meta=(Element)metadata.item(i);if("cover".equals(meta.getAttribute("name"))) legacyCoverId=meta.getAttribute("content"); }
        var manifest=new LinkedHashMap<String,ManifestItem>();var items=packageXml.getElementsByTagNameNS("*","item");
        for(int i=0;i<items.getLength();i++) {
            Element item=(Element)items.item(i);String id=item.getAttribute("id"),media=item.getAttribute("media-type"),properties=item.getAttribute("properties");
            manifest.put(id,new ManifestItem(id,resolve(opf,item.getAttribute("href")),media,properties));
        }
        List<TocSource> toc=toc(entries,manifest);var tocByPath=new LinkedHashMap<String,TocSource>();
        for(var entry:toc) tocByPath.putIfAbsent(entry.path(),entry);
        var assets=new ArrayList<AssetData>();
        for(var item:manifest.values()) if(item.mediaType().startsWith("image/") && entries.containsKey(item.path()))
            assets.add(new AssetData(item.path(),item.mediaType(),entries.get(item.path()),item.properties().contains("cover-image") || item.id().equals(legacyCoverId)));
        var sections=new ArrayList<SectionData>();var used=new HashSet<String>();var spine=packageXml.getElementsByTagNameNS("*","itemref");
        if(spine.getLength()==0) throw bad("В EPUB отсутствует порядок глав");
        for(int i=0;i<spine.getLength();i++) {
            Element ref=(Element)spine.item(i);ManifestItem item=manifest.get(ref.getAttribute("idref"));
            if(item==null || !isHtml(item.mediaType())) throw bad("EPUB содержит неподдерживаемую главу");used.add(item.id());
            sections.add(epubSection(entries,item,tocByPath.get(item.path()),"no".equals(ref.getAttribute("linear"))?"auxiliary":"main",sections.size()+1));
        }
        for(var item:manifest.values()) if(isHtml(item.mediaType()) && !used.contains(item.id()) && !item.properties().contains("nav"))
            sections.add(epubSection(entries,item,tocByPath.get(item.path()),"auxiliary",sections.size()+1));
        var result=book(title,author,genres,sections,assets);
        if(toc.isEmpty()) return result;
        var bases=new HashMap<String,Integer>();int cursor=0;
        for(int i=0;i<sections.size();i++) { if(i>0) cursor+=2;var section=sections.get(i);bases.put(section.sourcePath(),cursor);cursor+=section.text().length(); }
        var tocData=new ArrayList<TocData>();
        for(var entry:toc) {
            var section=sections.stream().filter(value->Objects.equals(value.sourcePath(),entry.path())).findFirst().orElse(null);Integer base=bases.get(entry.path());
            if(section==null || base==null) continue;int local=entry.fragment()==null?0:section.anchorOffsets().getOrDefault(entry.fragment(),0);
            tocData.add(new TocData(limit(entry.title(),500),section.role(),entry.level(),base+local));
        }
        return new ExtractedBook(result.text(),result.suggestedTitle(),result.author(),result.genres(),result.sections(),tocData.isEmpty()?result.toc():tocData,result.assets());
    }

    private SectionData epubSection(Map<String,byte[]> entries,ManifestItem item,TocSource tocEntry,String role,int number) throws IOException {
        var parser="application/xhtml+xml".equals(item.mediaType())?org.jsoup.parser.Parser.xmlParser():org.jsoup.parser.Parser.htmlParser();
        var html=org.jsoup.Jsoup.parse(new ByteArrayInputStream(required(entries,item.path())),null,"",parser);
        html.select("script,style,nav,svg,math").remove();var body=html.selectFirst("body");if(body==null) throw bad("В главе EPUB отсутствует body");
        String title=tocEntry==null?null:tocEntry.title();if(title==null) { var heading=body.selectFirst("h1,h2,h3,h4,h5,h6");if(heading!=null) title=clean(heading.text()); }
        if(title==null) title="Раздел "+number;var assetPaths=new ArrayList<String>();
        for(var image:body.select("img[src],image[href]")) {
            String ref=image.hasAttr("src")?image.attr("src"):image.attr("href");
            try { String resolved=resolve(item.path(),ref);if(!assetPaths.contains(resolved)) assetPaths.add(resolved); } catch(ResponseStatusException ignored) {}
        }
        var text=new StringBuilder();var anchors=new HashMap<String,Integer>();renderHtml(body,text,0,anchors);String value=text.toString().strip();if(value.isBlank()) value=title;
        int trimStart=0;while(trimStart<text.length() && Character.isWhitespace(text.charAt(trimStart))) trimStart++;
        var adjustedAnchors=new HashMap<String,Integer>();for(var anchor:anchors.entrySet()) adjustedAnchors.put(anchor.getKey(),Math.max(0,anchor.getValue()-trimStart));
        return new SectionData(limit(title,500),value,role,item.path(),assetPaths,tocEntry==null?0:tocEntry.level(),adjustedAnchors);
    }

    private List<TocSource> toc(Map<String,byte[]> entries,Map<String,ManifestItem> manifest) throws Exception {
        var result=new ArrayList<TocSource>();var seen=new HashSet<String>();
        for(var item:manifest.values()) if(item.properties().contains("nav") && entries.containsKey(item.path())) {
            var html=org.jsoup.Jsoup.parse(new ByteArrayInputStream(entries.get(item.path())),null,"",org.jsoup.parser.Parser.xmlParser());
            for(var link:html.select("a[href]")) try {
                String href=link.attr("href"),target=resolve(item.path(),href),label=clean(link.text());int level=0;
                for(var parent=link.parent();parent!=null;parent=parent.parent()) if("ol".equals(parent.tagName())) level++;
                String fragment=fragment(href),key=target+"#"+fragment;if(label!=null && seen.add(key)) result.add(new TocSource(label,Math.max(0,level-1),target,fragment));
            } catch(ResponseStatusException ignored) {}
        }
        for(var item:manifest.values()) if("application/x-dtbncx+xml".equals(item.mediaType()) && entries.containsKey(item.path())) {
            var ncx=xml(entries.get(item.path()));var points=ncx.getElementsByTagNameNS("*","navPoint");
            for(int i=0;i<points.getLength();i++) {
                Element point=(Element)points.item(i);var labels=point.getElementsByTagNameNS("*","navLabel");var contents=point.getElementsByTagNameNS("*","content");
                String label=labels.getLength()==0?null:firstText((Element)labels.item(0),"text");if(label==null || contents.getLength()==0) continue;
                String source=((Element)contents.item(0)).getAttribute("src");int level=0;
                for(Node parent=point.getParentNode();parent!=null;parent=parent.getParentNode()) if(parent instanceof Element value && "navPoint".equals(value.getLocalName())) level++;
                try {String target=resolve(item.path(),source),fragment=fragment(source),key=target+"#"+fragment;if(seen.add(key)) result.add(new TocSource(label,Math.min(12,level),target,fragment));} catch(ResponseStatusException ignored) {}
            }
        }
        return result;
    }

    private ExtractedBook book(String title,String author,List<SectionData> sections,List<AssetData> assets) {
        return book(title,author,List.of(),sections,assets);
    }
    private ExtractedBook book(String title,String author,List<String> genres,List<SectionData> sections,List<AssetData> assets) {
        if(sections.isEmpty()) throw bad("Книга не содержит доступных разделов");var text=new StringBuilder();var toc=new ArrayList<TocData>();
        for(var section:sections) { if(!text.isEmpty()) append(text,"\n\n");toc.add(new TocData(section.title(),section.role(),section.tocLevel(),text.length()));append(text,section.text()); }
        var normalizedGenres=new ArrayList<String>();
        for(String genre:genres) {String value=clean(genre);if(value!=null) {String candidate=limit(value,60);if(normalizedGenres.stream().noneMatch(existing->existing.equalsIgnoreCase(candidate))) normalizedGenres.add(candidate);}if(normalizedGenres.size()==12) break;}
        return new ExtractedBook(text.toString(),clean(title),clean(author),normalizedGenres,sections,toc,assets);
    }

    private org.w3c.dom.Document xml(byte[] bytes) throws Exception {
        var factory=DocumentBuilderFactory.newInstance();factory.setNamespaceAware(true);factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);factory.setFeature("http://xml.org/sax/features/external-general-entities",false);factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");factory.setAttribute("http://www.oracle.com/xml/jaxp/properties/maxElementDepth","128");factory.setXIncludeAware(false);factory.setExpandEntityReferences(false);
        var builder=factory.newDocumentBuilder();builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler(){@Override public void fatalError(SAXParseException e) throws SAXException {throw e;}@Override public void error(SAXParseException e) throws SAXException {throw e;}});
        return builder.parse(new ByteArrayInputStream(bytes));
    }
    private Map<String,byte[]> zipEntries(byte[] bytes) throws IOException {
        Map<String,byte[]> entries=new HashMap<>();long total=0;int count=0;
        try(var zip=new ZipInputStream(new ByteArrayInputStream(bytes))) { for(ZipEntry entry;(entry=zip.getNextEntry())!=null;) {
            if(++count>5000) throw bad("Слишком много файлов внутри EPUB");if(entry.isDirectory()) continue;String name=path(entry.getName());
            var output=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int read;while((read=zip.read(buffer))!=-1) {total+=read;if(total>MAX_ARCHIVE || output.size()+read>MAX_ENTRY) throw bad("EPUB слишком велик после распаковки");output.write(buffer,0,read);}
            if(entries.putIfAbsent(name,output.toByteArray())!=null) throw bad("Дублирующиеся пути внутри EPUB");
        }}return entries;
    }
    private void checkEncryption(Map<String,byte[]> entries) throws Exception {
        if(!entries.containsKey("META-INF/encryption.xml")) return;var encrypted=xml(entries.get("META-INF/encryption.xml")).getElementsByTagNameNS("*","EncryptionMethod");
        for(int i=0;i<encrypted.getLength();i++) {String algorithm=((Element)encrypted.item(i)).getAttribute("Algorithm");if(!Set.of("http://www.idpf.org/2008/embedding","http://ns.adobe.com/pdf/enc#RC").contains(algorithm)) throw bad("EPUB с DRM или шифрованием не поддерживается");}
    }
    private void renderFb(Node node,StringBuilder text,int depth) {
        if(depth>128) throw bad("Слишком глубокая структура книги");if(node.getNodeType()==Node.TEXT_NODE) {append(text,node.getNodeValue().replaceAll("\\s+"," "));return;}if(!(node instanceof Element element)) return;
        String name=element.getLocalName();if(Set.of("binary","image","description").contains(name)) return;if("title".equals(name)) {append(text,"\n\nГлава: "+clean(element.getTextContent())+"\n\n");return;}
        boolean block=Set.of("p","section","body","subtitle","v","stanza","empty-line","epigraph").contains(name);if(block) append(text,"\n");for(Node child=node.getFirstChild();child!=null;child=child.getNextSibling()) renderFb(child,text,depth+1);if(block) append(text,"\n");
    }
    private void renderFbOwn(Node node,StringBuilder text,int depth,boolean root) {
        if(depth>128) throw bad("Слишком глубокая структура книги");if(node.getNodeType()==Node.TEXT_NODE) {append(text,node.getNodeValue().replaceAll("\\s+"," "));return;}if(!(node instanceof Element element)) return;
        String name=element.getLocalName();if(Set.of("binary","image","description").contains(name) || (!root && "section".equals(name))) return;if("title".equals(name)) {append(text,"\n\nГлава: "+clean(element.getTextContent())+"\n\n");return;}
        boolean block=Set.of("p","section","body","subtitle","v","stanza","empty-line","epigraph").contains(name);if(block) append(text,"\n");for(Node child=node.getFirstChild();child!=null;child=child.getNextSibling()) renderFbOwn(child,text,depth+1,false);if(block) append(text,"\n");
    }
    private void renderHtml(org.jsoup.nodes.Node node,StringBuilder text,int depth,Map<String,Integer> anchors) {
        if(depth>128) throw bad("Слишком глубокая структура книги");if(node instanceof org.jsoup.nodes.TextNode value) {append(text,value.text());return;}
        if(node instanceof org.jsoup.nodes.Element element) {for(String attribute:List.of("id","xml:id","name")) {String anchor=clean(element.attr(attribute));if(anchor!=null) anchors.putIfAbsent(anchor,text.length());}if(element.tagName().matches("h[1-6]") || element.classNames().stream().anyMatch(c->c.matches("title\\d*"))) {append(text,"\n\nГлава: "+element.text()+"\n\n");return;}
            boolean block=element.isBlock() || Set.of("p","div","section","article","blockquote","li","tr","br").contains(element.tagName());if(block) append(text,"\n");for(var child:element.childNodes()) renderHtml(child,text,depth+1,anchors);if(block) append(text,"\n");}
    }
    private List<Element> directChildren(Element parent,String name) {var result=new ArrayList<Element>();for(Node node=parent.getFirstChild();node!=null;node=node.getNextSibling()) if(node instanceof Element element && name.equals(element.getLocalName())) result.add(element);return result;}
    private String sectionTitle(Element section,String fallback) {var titles=directChildren(section,"title");return titles.isEmpty()?fallback:Optional.ofNullable(clean(titles.getFirst().getTextContent())).orElse(fallback);}
    private String firstText(Element root,String localName) {var nodes=root.getElementsByTagNameNS("*",localName);return nodes.getLength()==0?null:clean(nodes.item(0).getTextContent());}
    private List<String> texts(Element root,String localName) {var values=new ArrayList<String>();var nodes=root.getElementsByTagNameNS("*",localName);for(int i=0;i<nodes.getLength();i++) {String value=clean(nodes.item(i).getTextContent());if(value!=null) values.add(value);}return values;}
    private String href(Element image) {for(int i=0;i<image.getAttributes().getLength();i++) {Node item=image.getAttributes().item(i);if("href".equals(item.getLocalName()) || "href".equals(item.getNodeName())) {String value=item.getNodeValue();return value.startsWith("#")?value.substring(1):value;}}return null;}
    private String fragment(String value) {int index=value==null?-1:value.indexOf('#');if(index<0 || index+1>=value.length()) return null;try{return java.net.URLDecoder.decode(value.substring(index+1),StandardCharsets.UTF_8);}catch(IllegalArgumentException ignored){return value.substring(index+1);}}
    private boolean isHtml(String media) {return "application/xhtml+xml".equals(media) || "text/html".equals(media);}
    private String resolve(String base,String value) {if(value==null || value.isBlank()) throw bad("Некорректные пути EPUB");String clean=value.split("#",2)[0];URI reference=URI.create(clean.replace(" ","%20"));if(reference.isAbsolute() || reference.getAuthority()!=null) throw bad("Внешние ресурсы EPUB не поддерживаются");String decoded=reference.getPath();var parent=java.nio.file.Path.of(base).getParent();String resolved=(parent==null?java.nio.file.Path.of(decoded):parent.resolve(decoded)).normalize().toString().replace('\\','/');return path(resolved);}
    private String path(String value) {if(value==null || value.isBlank() || value.length()>1000 || value.startsWith("/") || value.contains("\\") || value.contains(":")) throw bad("Некорректные пути EPUB");var normalized=java.nio.file.Path.of(value).normalize();if(normalized.startsWith("..")) throw bad("Некорректные пути EPUB");return normalized.toString().replace('\\','/');}
    private byte[] required(Map<String,byte[]> entries,String name) {var bytes=entries.get(name);if(bytes==null) throw bad("В EPUB отсутствует необходимый файл главы");return bytes;}
    private String clean(String value) {if(value==null) return null;String result=value.replaceAll("\\s+"," ").strip();return result.isBlank()?null:result;}
    private String limit(String value,int max) {return value.length()<=max?value:value.substring(0,max);}
    private void append(StringBuilder text,String value) {if(value==null) return;if(text.length()+value.length()>MAX_TEXT) throw bad("Максимум — 12 000 000 символов извлечённого текста");text.append(value);}
    private ResponseStatusException bad(String message) {return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}

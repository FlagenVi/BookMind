package afoni.projectf.service;

import java.util.*;
import java.util.regex.Pattern;

/** Selects bounded, traceable excerpts from the uploaded book, never beyond the saved position. */
public final class BookChatContext {
    private static final int WINDOW=2200;
    private static final int STEP=2000;
    private static final int MAX_WINDOWS=6;
    private static final Pattern WORD=Pattern.compile("[\\p{L}\\p{N}]{4,}");

    public record Section(int number,String title,int start,int end) {}
    /** preview is the start of the excerpt, shown next to the chapter title so several sources in one chapter differ. */
    public record Reference(int sectionNumber,String title,int startOffset,int endOffset,String preview) {}
    public record Selection(String text,List<Reference> references,int positionOffset) {}
    private record Candidate(Reference reference,String text,double score) {}
    private record Window(Reference reference,String text,Map<String,Integer> counts) {}
    // Longest first. A light stemmer is enough to match "письмо", "письма" and "письмом" for retrieval.
    private static final List<String> ENDINGS=Arrays.stream(new String[]{
            "иями","ями","ами","ого","его","ому","ему","ыми","ими","ией","ться","тся","ешь","ете","ите","ала","ило","или",
            "ий","ый","ой","ая","яя","ое","ее","ые","ие","ых","их","ом","ем","ам","ям","ах","ях","ую","юю","ов","ев","ей",
            "ия","ию","ью","ет","ют","ут","ит","ат","ят","ла","ли","ло","ть",
            "ing","ed","es",
            "а","я","о","е","ы","и","у","ю","ь","й","л","s"})
            .sorted(Comparator.comparingInt(String::length).reversed()).toList();
    // Question words that say nothing about where the answer is.
    private static final Set<String> STOP_WORDS=Set.of("почему","зачем","когда","какой","какая","какие","каким","какое","который",
            "которая","которые","этот","этом","этой","этого","того","тому","такой","также","было","были","была","будет","есть",
            "чтобы","книге","книги","книга","книгу","главе","главы","глава","расскажи","объясни","произошло","происходит",
            "what","which","when","where","there","this","that","with","does","about","book","chapter","happened");
    private static final Set<String> STOP_STEMS=STOP_WORDS.stream().map(BookChatContext::stem).collect(java.util.stream.Collectors.toSet());

    /**
     * The first words of an excerpt; a window cut mid-word skips that partial word,
     * and a chapter heading already shown as the title is not repeated.
     */
    static String preview(String excerpt,boolean cutMidText,String title) {
        String value=excerpt.strip().replaceAll("\\s+"," ");
        if(cutMidText) {
            int space=value.indexOf(' ');
            if(space>0 && space<30) value=value.substring(space+1);
        }
        String heading=title==null?"":title.strip().replaceAll("\\s+"," ");
        if(!heading.isEmpty() && value.startsWith(heading) && value.length()>heading.length())
            value=value.substring(heading.length()).strip();
        if(value.length()<=48) return value;
        int cut=value.lastIndexOf(' ',48);
        return value.substring(0,cut>20?cut:48)+"…";
    }

    static String stem(String word) {
        String value=word.toLowerCase(Locale.ROOT).replace('ё','е');
        for(String ending:ENDINGS)
            if(value.endsWith(ending) && value.length()-ending.length()>=3) return value.substring(0,value.length()-ending.length());
        return value;
    }

    private BookChatContext() {}

    public static Selection selectedFragment(String book,int confirmedOffset,int startOffset,int endOffset,String exactText,List<Section> sections) {
        int boundary=Math.max(0,Math.min(book.length(),Math.max(confirmedOffset,endOffset)));
        int start=Math.max(0,Math.min(boundary,startOffset));
        int end=Math.max(start,Math.min(boundary,endOffset));
        if(end<=start || end-start>10_000 || exactText==null || !book.substring(start,end).equals(exactText))
            throw new IllegalArgumentException("Выделенный фрагмент изменился или находится за пределами прочитанного текста");
        Section section=sections.stream().filter(item->start>=item.start() && start<item.end()).findFirst()
                .orElse(new Section(0,"Выделенный фрагмент",start,end));
        // Selecting text is an explicit request to use its immediate surroundings.
        // Include both sides even when the saved reading anchor is at the beginning
        // of the visible paragraph, otherwise a name at the anchor looks like a title.
        int contextStart=Math.max(section.start(),start-800);
        int contextEnd=Math.min(section.end(),end+1200);
        Reference reference=new Reference(section.number(),section.title(),contextStart,contextEnd,preview(exactText,false,null));
        String before=book.substring(contextStart,start);
        String after=book.substring(end,contextEnd);
        String text="[1] "+section.title()+" (позиции "+contextStart+"–"+contextEnd+")\n"
                +"Контекст перед выделением:\n"+before
                +"\n\nВыделенный пользователем фрагмент:\n<<<\n"+exactText+"\n>>>"
                +"\n\nКонтекст после выделения:\n"+after;
        return new Selection(text,List.of(reference),boundary);
    }

    public static Selection select(String book,int confirmedOffset,String question,List<Section> sections) {
        int boundary=Math.max(0,Math.min(book.length(),confirmedOffset));
        if(boundary==0) return new Selection("",List.of(),0);
        Set<String> terms=new LinkedHashSet<>();
        var matcher=WORD.matcher(question);
        while(matcher.find()) {
            String term=stem(matcher.group());
            if(!STOP_STEMS.contains(term)) terms.add(term);
        }
        List<Section> available=sections.isEmpty()?List.of(new Section(0,"Текст книги",0,boundary)):sections;
        var windows=new ArrayList<Window>();
        var documentFrequency=new HashMap<String,Integer>();
        for(var section:available) {
            int start=Math.max(0,Math.min(boundary,section.start()));
            int end=Math.max(start,Math.min(boundary,section.end()));
            for(int from=start;from<end;from+=STEP) {
                int to=Math.min(end,from+WINDOW);
                String excerpt=book.substring(from,to);
                var counts=new HashMap<String,Integer>();
                var words=WORD.matcher(section.title()+" "+excerpt);
                while(words.find()) {
                    String word=stem(words.group());
                    if(terms.contains(word)) counts.merge(word,1,Integer::sum);
                }
                counts.keySet().forEach(term->documentFrequency.merge(term,1,Integer::sum));
                windows.add(new Window(new Reference(section.number(),section.title(),from,to,preview(excerpt,from>section.start(),section.title())),excerpt,counts));
            }
        }
        if(windows.isEmpty()) return new Selection("",List.of(),boundary);
        // BM25-style weighting: a rare name outweighs a word repeated on every page,
        // and many repeats of one word in a window count less than several different words.
        var candidates=new ArrayList<Candidate>();
        for(var window:windows) {
            double score=0;
            for(var entry:window.counts().entrySet()) {
                int frequency=documentFrequency.get(entry.getKey());
                double rarity=Math.log(1+(windows.size()-frequency+0.5)/(frequency+0.5));
                score+=rarity*entry.getValue()*2.2/(entry.getValue()+1.2);
            }
            candidates.add(new Candidate(window.reference(),window.text(),score));
        }
        var chosen=new ArrayList<Candidate>();
        if(candidates.stream().anyMatch(candidate->candidate.score()>0)) {
            Candidate latest=candidates.getLast();
            chosen.addAll(candidates.stream().sorted(Comparator.comparingDouble(Candidate::score).reversed()
                    .thenComparingInt(candidate->candidate.reference().startOffset())).limit(MAX_WINDOWS-1).toList());
            if(!chosen.contains(latest)) chosen.add(latest);
            else candidates.stream().filter(candidate->!chosen.contains(candidate))
                    .max(Comparator.comparingDouble(Candidate::score)).ifPresent(chosen::add);
        } else {
            int count=Math.min(MAX_WINDOWS,candidates.size());
            for(int i=0;i<count;i++) {
                int index=count==1?0:(int)Math.round(i*(candidates.size()-1.0)/(count-1));
                Candidate candidate=candidates.get(index);
                if(!chosen.contains(candidate)) chosen.add(candidate);
            }
        }
        chosen.sort(Comparator.comparingInt(candidate->candidate.reference().startOffset()));
        var text=new StringBuilder();var references=new ArrayList<Reference>();
        for(var candidate:chosen) {
            Reference reference=candidate.reference();references.add(reference);
            if(!text.isEmpty()) text.append("\n\n");
            text.append('[').append(references.size()).append("] ").append(reference.title())
                    .append(" (позиции ").append(reference.startOffset()).append('–').append(reference.endOffset()).append(")\n")
                    .append(candidate.text());
        }
        return new Selection(text.toString(),List.copyOf(references),boundary);
    }
}

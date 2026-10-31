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
    public record Reference(int sectionNumber,String title,int startOffset,int endOffset) {}
    public record Selection(String text,List<Reference> references,int positionOffset) {}
    private record Candidate(Reference reference,String text,int score) {}

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
        Reference reference=new Reference(section.number(),section.title(),contextStart,contextEnd);
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
        var matcher=WORD.matcher(question.toLowerCase(Locale.ROOT));
        while(matcher.find()) terms.add(matcher.group());
        List<Section> available=sections.isEmpty()?List.of(new Section(0,"Текст книги",0,boundary)):sections;
        var candidates=new ArrayList<Candidate>();
        for(var section:available) {
            int start=Math.max(0,Math.min(boundary,section.start()));
            int end=Math.max(start,Math.min(boundary,section.end()));
            for(int from=start;from<end;from+=STEP) {
                int to=Math.min(end,from+WINDOW);
                String excerpt=book.substring(from,to);
                String searchable=(section.title()+" "+excerpt).toLowerCase(Locale.ROOT);
                int score=0;
                for(String term:terms) {
                    int at=0;
                    while((at=searchable.indexOf(term,at))>=0) {score++;at+=term.length();}
                }
                candidates.add(new Candidate(new Reference(section.number(),section.title(),from,to),excerpt,score));
            }
        }
        if(candidates.isEmpty()) return new Selection("",List.of(),boundary);
        var chosen=new ArrayList<Candidate>();
        if(candidates.stream().anyMatch(candidate->candidate.score()>0)) {
            Candidate latest=candidates.getLast();
            chosen.addAll(candidates.stream().sorted(Comparator.comparingInt(Candidate::score).reversed()
                    .thenComparingInt(candidate->candidate.reference().startOffset())).limit(MAX_WINDOWS-1).toList());
            if(!chosen.contains(latest)) chosen.add(latest);
            else candidates.stream().filter(candidate->!chosen.contains(candidate))
                    .max(Comparator.comparingInt(Candidate::score)).ifPresent(chosen::add);
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

package afoni.projectf.service;

import com.knuddels.jtokkit.Encodings;
import com.knuddels.jtokkit.api.EncodingType;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.core.env.StandardEnvironment;

/** Explicit bounded experiment. Never prints settings, raw provider responses or exception objects. */
public class ChapterComparison {
 static long retryTokens=0,retryMillis=0,retryWait=0; static int extraCalls=0;
 static Summarizer.Result call(GroqSummarizer adapter,String text,String model,int bytes,int chars) throws InterruptedException {
  String mode="fragment";
  for(int attempt=0;attempt<3;attempt++) {
   long begin=System.nanoTime();
   try { return adapter.summarizeWithBudget(text,mode,model,bytes,chars); }
   catch(Summarizer.Failure f) {
    retryTokens+=f.tokens; extraCalls++; if(!f.retryable || attempt==2 || f.retrySeconds>90) throw f;
    System.out.println("Bounded retry: attempt="+(attempt+1)+"; tokens="+f.tokens+"; cooldown="+f.retrySeconds);
    if(f.repairText!=null) { text=f.repairText;mode="repair_fragment";bytes=40000; }
    retryMillis+=(System.nanoTime()-begin)/1000000;retryWait+=f.retrySeconds;Thread.sleep(f.retrySeconds*1000);
   }
  } throw new IllegalStateException();
 }
 public static void main(String[] args) throws Exception {
  String book=new BookTextExtractor().extract(Files.readAllBytes(Path.of(args[0])),"epub");
  var encoding=Encodings.newDefaultEncodingRegistry().getEncoding(EncodingType.O200K_BASE);
  var headings=Pattern.compile("(?m)^Глава:[^\\r\\n]*").matcher(book);
  var starts=new ArrayList<Integer>();var names=new ArrayList<String>();
  while(headings.find()) {starts.add(headings.start());names.add(headings.group());}
  String chapter=null;String name=null;
  for(int i=0;i<starts.size();i++) {
   String section=book.substring(starts.get(i),i+1<starts.size()?starts.get(i+1):book.length()).strip();
   int count=encoding.countTokensOrdinary(section);
   if(count>=2000 && count<=4000 && !names.get(i).toLowerCase(Locale.ROOT).matches(".*(предислов|примечан|введен).*")) {chapter=section;name=names.get(i);break;}
  }
  if(chapter==null) {System.out.println("No suitable complete chapter found; no API requests sent.");return;}
  var inputs=SummaryQueue.split(chapter);
  System.out.println("Chapter: "+name+"; characters="+chapter.length()+"; estimated text tokens="+encoding.countTokensOrdinary(chapter)+"; baseline chunks="+inputs.size());
  Path output=Path.of(".local/chapter-comparison.md");
  if(args.length<3) Files.writeString(output,"# Сравнение на одной полной главе\n\n"+name+"\n\nТекст: "+chapter.length()+" символов, "+encoding.countTokensOrdinary(chapter)+" токенов o200k_base (без служебного формата Harmony).\n\n",StandardCharsets.UTF_8);
  if(args.length<2 || !args[1].equals("run")) return;
  if(inputs.size()>5) {System.out.println("Request budget exceeded; no API requests sent.");return;}
  var settings=new LlmSettings(new StandardEnvironment());var adapter=new GroqSummarizer(settings);
  for(int variant=args.length>=3?1:0;variant<2;variant++) {
   retryTokens=0;retryMillis=0;retryWait=0;extraCalls=0;
   var chunks=variant==0?inputs:List.of(chapter);var summaries=new ArrayList<String>();
   long tokens=0,apiMillis=0,waitSeconds=0;int calls=0;boolean failed=false;
   for(String input:chunks) {
    long begin=System.nanoTime();
    try {
     var result=call(adapter,input,settings.model(),variant==0?8000:40000,variant==0?1000:2200);
     calls++;apiMillis+=(System.nanoTime()-begin)/1000000;tokens+=result.tokens();summaries.add(result.text());
     System.out.println("Variant "+variant+": request "+calls+" OK; tokens="+result.tokens()+"; response chars="+result.text().length()+"; cooldown="+result.retrySeconds());
     waitSeconds+=result.retrySeconds();Thread.sleep(result.retrySeconds()*1000);
    } catch(Summarizer.Failure failure) {System.out.println("Experiment stopped: "+failure.getMessage());Files.writeString(output,"\nОстановлено: "+failure.getMessage()+"; учтённые токены="+(tokens+failure.tokens)+"\n",StandardOpenOption.APPEND);failed=true;break;}
   }
   if(failed) return;
   if(variant==0 && summaries.size()>1) {
    String combined=String.join("\n\n",summaries);long begin=System.nanoTime();
    try {
     var result=call(adapter,combined,settings.model(),40000,1000);
     calls++;apiMillis+=(System.nanoTime()-begin)/1000000;tokens+=result.tokens();summaries= new ArrayList<>(List.of(result.text()));
     System.out.println("Variant 0: merge OK; tokens="+result.tokens()+"; cooldown="+result.retrySeconds());
     waitSeconds+=result.retrySeconds();Thread.sleep(result.retrySeconds()*1000);
    } catch(Summarizer.Failure failure) {System.out.println("Merge stopped: "+failure.getMessage());return;}
   }
   calls+=extraCalls;tokens+=retryTokens;apiMillis-=retryWait*1000;waitSeconds+=retryWait;
   String result="## "+(variant==0?"A: текущие фрагменты, ответ до 1000 символов":"B: глава целиком, ответ до 2200 символов")+"\n\nЗапросов: "+calls+"; токенов: "+tokens+"; API: "+apiMillis+" мс; ожидание квоты после ответов: "+waitSeconds+" с.\n\n"+String.join("\n\n",summaries)+"\n\n";
   Files.writeString(output,result,StandardCharsets.UTF_8,StandardOpenOption.APPEND);
   System.out.println("Variant "+variant+" complete; requests="+calls+"; tokens="+tokens+"; API ms="+apiMillis+"; cooldown seconds="+waitSeconds);
  }
 }
}

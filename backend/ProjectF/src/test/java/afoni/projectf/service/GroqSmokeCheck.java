package afoni.projectf.service;

import org.springframework.core.env.StandardEnvironment;

/** No Spring context or database; never prints credentials, provider bodies or exceptions. */
public class GroqSmokeCheck {
    public static void main(String[] args) {
        var settings=new LlmSettings(new StandardEnvironment());
        try {
            var result=new GroqSummarizer(settings).summarize(
                    "В учебной библиотеке внедрили электронный каталог. Поиск книг стал занимать две минуты вместо десяти. За первый месяц каталогом воспользовались 120 студентов. В следующем месяце планируют добавить поиск по авторам.",
                    "medium",settings.model());
            System.out.println("Groq smoke check: OK; output characters="+result.text().length()+"; total tokens="+result.tokens());
        } catch(Summarizer.Failure failure) {
            System.out.println("Groq smoke check: FAILED; "+failure.getMessage());
            System.exit(1);
        }
    }
}

package afoni.projectf.service;

import org.springframework.core.env.StandardEnvironment;

/** No Spring context or database; never prints credentials, provider bodies or exceptions. */
public class DeepSeekSmokeCheck {
    public static void main(String[] args) {
        var settings=new LlmSettings(new StandardEnvironment());
        if(!settings.configured()) {
            System.err.println("DeepSeek smoke check: CONFIG_ERROR; check "+settings.configurationIssue());
            System.exit(1);
            return;
        }
        try {
            var result=new DeepSeekSummarizer(settings).summarize(
                    "В учебной библиотеке внедрили электронный каталог. Поиск книг стал занимать две минуты вместо десяти. За первый месяц каталогом воспользовались 120 студентов. В следующем месяце планируют добавить поиск по авторам.",
                    "medium",settings.model());
            System.out.println("DeepSeek smoke check: OK; output characters="+result.text().length()+"; total tokens="+result.tokens());
        } catch(Summarizer.Failure failure) {
            System.err.println("DeepSeek smoke check: "+failure.code+"; retryable="+failure.retryable+"; retryAfterSeconds="+failure.retrySeconds);
            System.exit(1);
        }
    }
}

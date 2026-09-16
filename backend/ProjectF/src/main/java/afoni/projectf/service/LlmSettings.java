package afoni.projectf.service;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.nio.file.*;
import java.util.*;

@Component
public class LlmSettings {
    private final String key;
    private final String model;
    private final boolean valid;
    private final String configurationIssue;
    public LlmSettings(Environment environment) {
        Map<String,String> local=new HashMap<>();
        // Read only inside the backend, never log file contents or parser exceptions.
        if (environment.getProperty("llm.env-enabled",Boolean.class,true)) {
            Path path=Path.of(".env");
            if (Files.isRegularFile(path)) try {
                for(String line:Files.readAllLines(path)) {
                    line=line.strip().replaceFirst("^\\uFEFF", "");
                    int split=line.indexOf('='); if(split<0 || line.startsWith("#")) continue;
                    String name=line.substring(0,split).strip();
                    if(!Set.of("LLM_API_KEY","LLM_MODEL","LLM_BASE_URL","LLM_PROVIDER").contains(name)) continue;
                    String value=line.substring(split+1).strip();
                    if(value.length()>1 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) value=value.substring(1,value.length()-1);
                    local.put(name,value);
                }
            } catch(Exception ignored) { /* unavailable config is reported without values */ }
        }
        key=environment.getProperty("LLM_API_KEY",local.getOrDefault("LLM_API_KEY",""));
        model=environment.getProperty("LLM_MODEL",local.getOrDefault("LLM_MODEL","deepseek-flash"));
        String base=environment.getProperty("LLM_BASE_URL",local.getOrDefault("LLM_BASE_URL","https://api.deepseek.com"));
        String provider=environment.getProperty("LLM_PROVIDER",local.getOrDefault("LLM_PROVIDER","deepseek"));
        var problems=new ArrayList<String>();
        if(!provider.equals("deepseek")) problems.add("LLM_PROVIDER");
        if(!base.replaceAll("/$", "").equals("https://api.deepseek.com")) problems.add("LLM_BASE_URL");
        if(!Set.of("deepseek-flash","deepseek-v4-pro").contains(model)) problems.add("LLM_MODEL");
        if(key.isBlank()) problems.add("LLM_API_KEY");
        configurationIssue=String.join(", ",problems);
        valid=problems.isEmpty();
    }
    public boolean configured() { return valid; }
    public String configurationIssue() { return configurationIssue; }
    String key() { return key; }
    public String model() { return model; }
}

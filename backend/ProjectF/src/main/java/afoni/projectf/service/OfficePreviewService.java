package afoni.projectf.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Service
public class OfficePreviewService {
    private static final long MAX_PREVIEW_BYTES=100L*1024*1024;
    private final String configuredCommand;
    private final String configuredWord;
    private volatile boolean commandSearched;
    private volatile String resolvedCommand;

    public OfficePreviewService(@Value("${app.office.soffice-path:}") String configuredCommand,
                                @Value("${app.office.word-path:}") String configuredWord) {
        this.configuredCommand=configuredCommand==null?"":configuredCommand.strip();
        this.configuredWord=configuredWord==null?"":configuredWord.strip();
    }

    public Optional<byte[]> docxToPdf(byte[] source) {
        var word=wordToPdf(source);
        if(word.isPresent()) return word;
        String command=command();
        if(command==null) return Optional.empty();
        Path directory=null;
        try {
            directory=Files.createTempDirectory("projectf-docx-preview-");
            Path input=directory.resolve("document.docx"),output=directory.resolve("document.pdf");
            Files.write(input,source,StandardOpenOption.CREATE_NEW);
            var process=new ProcessBuilder(command,"--headless","--safe-mode","--nologo","--nodefault","--nolockcheck",
                    "-env:UserInstallation="+directory.resolve("profile").toUri(),"--convert-to","pdf:writer_pdf_Export",
                    "--outdir",directory.toString(),input.toString())
                    .redirectErrorStream(true).redirectOutput(directory.resolve("conversion.log").toFile()).start();
            if(!process.waitFor(Duration.ofSeconds(60).toMillis(),TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();return Optional.empty();
            }
            if(process.exitValue()!=0 || !Files.isRegularFile(output)) return Optional.empty();
            long size=Files.size(output);
            if(size<=0 || size>MAX_PREVIEW_BYTES) return Optional.empty();
            return Optional.of(Files.readAllBytes(output));
        } catch(IOException error) {
            resolvedCommand=null;commandSearched=false;return Optional.empty();
        } catch(InterruptedException error) {
            Thread.currentThread().interrupt();return Optional.empty();
        } finally {
            if(directory!=null) delete(directory);
        }
    }

    public boolean available() { return wordCommand()!=null || command()!=null; }

    private Optional<byte[]> wordToPdf(byte[] source) {
        String word=wordCommand();
        if(word==null) return Optional.empty();
        Path directory=null;
        try {
            directory=Files.createTempDirectory("projectf-word-preview-");
            Path input=directory.resolve("document.docx"),output=directory.resolve("document.pdf"),script=directory.resolve("convert.ps1");
            Files.write(input,source,StandardOpenOption.CREATE_NEW);
            Files.writeString(script,"""
                    param([string]$inputPath, [string]$outputPath)
                    $ErrorActionPreference = 'Stop'
                    $wordApplication = $null
                    $wordDocument = $null
                    try {
                        $wordApplication = New-Object -ComObject Word.Application
                        $wordApplication.Visible = $false
                        $wordApplication.DisplayAlerts = 0
                        $wordApplication.AutomationSecurity = 3
                        $wordDocument = $wordApplication.Documents.Open($inputPath, $false, $true)
                        $wordDocument.ExportAsFixedFormat($outputPath, 17)
                    } finally {
                        if ($null -ne $wordDocument) {
                            $wordDocument.Close(0)
                            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordDocument)
                        }
                        if ($null -ne $wordApplication) {
                            $wordApplication.Quit()
                            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApplication)
                        }
                    }
                    """);
            var process=new ProcessBuilder("powershell.exe","-NoProfile","-NonInteractive","-Sta","-WindowStyle","Hidden",
                    "-ExecutionPolicy","Bypass","-File",script.toString(),input.toString(),output.toString())
                    .redirectErrorStream(true).redirectOutput(directory.resolve("conversion.log").toFile()).start();
            if(!process.waitFor(Duration.ofSeconds(60).toMillis(),TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();return Optional.empty();
            }
            if(process.exitValue()!=0 || !Files.isRegularFile(output)) return Optional.empty();
            long size=Files.size(output);
            if(size<=0 || size>MAX_PREVIEW_BYTES) return Optional.empty();
            return Optional.of(Files.readAllBytes(output));
        } catch(IOException error) {
            return Optional.empty();
        } catch(InterruptedException error) {
            Thread.currentThread().interrupt();return Optional.empty();
        } finally {
            if(directory!=null) delete(directory);
        }
    }

    private String wordCommand() {
        var candidates=new ArrayList<String>();
        if(!configuredWord.isBlank()) candidates.add(configuredWord);
        for(String base:List.of("C:\\Program Files","C:\\Program Files (x86)")) {
            candidates.add(Path.of(base,"Microsoft Office","root","Office16","WINWORD.EXE").toString());
            candidates.add(Path.of(base,"Microsoft Office","Office16","WINWORD.EXE").toString());
        }
        return candidates.stream().filter(candidate->Files.isRegularFile(Path.of(candidate))).findFirst().orElse(null);
    }

    private String command() {
        if(commandSearched) return resolvedCommand;
        synchronized(this) {
            if(commandSearched) return resolvedCommand;
            var candidates=new ArrayList<String>();
            if(!configuredCommand.isBlank()) candidates.add(configuredCommand);
            for(String variable:List.of("ProgramFiles","ProgramFiles(x86)")) {
                String base=System.getenv(variable);
                if(base!=null) candidates.add(Path.of(base,"LibreOffice","program","soffice.exe").toString());
            }
            candidates.addAll(List.of("soffice","libreoffice"));
            for(String candidate:candidates) if(executable(candidate)) {resolvedCommand=candidate;break;}
            commandSearched=true;return resolvedCommand;
        }
    }

    private boolean executable(String command) {
        Path path;
        try {path=Path.of(command);} catch(InvalidPathException error) {return false;}
        if(path.isAbsolute() || command.contains("/") || command.contains("\\")) return Files.isRegularFile(path);
        try {
            var process=new ProcessBuilder(command,"--version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if(!process.waitFor(5,TimeUnit.SECONDS)) {process.destroyForcibly();return false;}
            return process.exitValue()==0;
        } catch(Exception error) {return false;}
    }

    private void delete(Path root) {
        try(var files=Files.walk(root)) {
            files.sorted(Comparator.reverseOrder()).forEach(path->{try {Files.deleteIfExists(path);} catch(IOException ignored) {}});
        } catch(IOException ignored) {}
    }
}

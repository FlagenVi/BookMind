package afoni.projectf.controller;

import afoni.projectf.model.Note;
import afoni.projectf.service.NoteService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class NoteController {

    private final NoteService noteService;

    public NoteController(NoteService noteService) {
        this.noteService = noteService;
    }

    @GetMapping("/api/notes")
    public List<Note> getAllNotes() {
        return noteService.getAllNotes();
    }

    @GetMapping("/api/notes/{id}")
    public Note getNoteById(@PathVariable Long id) {
        return noteService.getNoteById(id);
    }

    @PostMapping("/api/notes")
    public Note saveNote(@RequestBody Note note) {
        return noteService.saveNote(note);
    }

    @DeleteMapping("/api/notes/{id}")
    public void deleteNoteById(@PathVariable Long id) {
        noteService.deleteNoteById(id);
    }

    @PutMapping("/api/notes/{id}")
    public Note updateNoteById(@PathVariable Long id, @RequestBody Note note) {
        return  noteService.updateNoteById(id, note);
    }
}

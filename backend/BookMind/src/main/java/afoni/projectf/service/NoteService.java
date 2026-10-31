package afoni.projectf.service;

import afoni.projectf.exception.NoteNotFoundException;
import afoni.projectf.model.Note;
import afoni.projectf.repository.NoteRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class NoteService {

    private final NoteRepository noteRepository;

    public NoteService(NoteRepository noteRepository) {
        this.noteRepository = noteRepository;
    }

    public List<Note> getAllNotes() {
        return noteRepository.findAll();
    }

    public Note getNoteById(Long id) {
        return noteRepository.findById(id)
                .orElseThrow(() -> new NoteNotFoundException(id)); //Выкидываем ошибку, если не нашли по айди
    }

    public Note saveNote(Note note) {
        LocalDateTime now = LocalDateTime.now();
        note.setCreatedAt(now);
        note.setUpdatedAt(now);
        return noteRepository.save(note);
    }

    public void deleteNoteById(Long id) {
        Note note = noteRepository.findById(id)
                .orElseThrow(() -> new NoteNotFoundException(id));
        noteRepository.delete(note);
    }

    public Note updateNoteById(Long id, Note note) {
        Note existingNote = noteRepository.findById(id)
                .orElseThrow(() -> new NoteNotFoundException(id));

        existingNote.setTitle(note.getTitle());
        existingNote.setContent(note.getContent());
        existingNote.setUpdatedAt(LocalDateTime.now());

        return noteRepository.save(existingNote);
    }
}

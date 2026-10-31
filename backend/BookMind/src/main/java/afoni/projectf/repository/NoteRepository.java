package afoni.projectf.repository;

import afoni.projectf.model.Note;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NoteRepository extends JpaRepository<Note, Long> {

}

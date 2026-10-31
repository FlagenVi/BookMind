ALTER TABLE documents
    ADD COLUMN library_status VARCHAR(24) NOT NULL DEFAULT 'want_to_read';

ALTER TABLE documents
    ADD CONSTRAINT documents_library_status_valid
    CHECK (library_status IN ('want_to_read', 'reading', 'finished'));

ALTER TABLE reading_progress
    ADD COLUMN last_read_at TIMESTAMPTZ;

ALTER TABLE reading_progress
    ADD COLUMN reading_seconds BIGINT NOT NULL DEFAULT 0;

ALTER TABLE reading_progress
    ADD CONSTRAINT reading_progress_seconds_nonnegative
    CHECK (reading_seconds >= 0);

CREATE TABLE book_genres (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    genre VARCHAR(60) NOT NULL,
    PRIMARY KEY (document_id, genre)
);

CREATE INDEX book_genres_genre_idx ON book_genres(lower(genre));
CREATE INDEX documents_library_status_idx ON documents(user_id, library_status);

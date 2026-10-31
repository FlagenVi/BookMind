ALTER TABLE book_upload_sessions
    DROP CONSTRAINT IF EXISTS book_upload_sessions_status_check;

ALTER TABLE book_upload_sessions
    ADD CONSTRAINT book_upload_sessions_status_check
    CHECK (status IN ('uploading', 'queued', 'importing', 'completed', 'failed'));

ALTER TABLE book_upload_sessions
    ADD COLUMN expected_sha256 CHAR(64),
    ADD COLUMN import_progress INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN error_message VARCHAR(500),
    ADD COLUMN imported_sections INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN expected_spine_items INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN imported_spine_items INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN imported_images INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN missing_images INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN skipped_toc_entries INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN metadata_warnings VARCHAR(1000),
    ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT book_upload_sessions_import_progress_valid
        CHECK (import_progress BETWEEN 0 AND 100);

CREATE INDEX book_upload_sessions_import_queue_idx
ON book_upload_sessions(updated_at, id)
WHERE status IN ('queued', 'importing');

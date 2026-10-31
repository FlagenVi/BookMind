ALTER TABLE documents
    ADD COLUMN material_type VARCHAR(8) NOT NULL DEFAULT 'DOCUMENT';

UPDATE documents
SET material_type = 'BOOK'
WHERE source_type IN ('epub', 'fb2');

ALTER TABLE documents
    ADD CONSTRAINT documents_material_type_valid
    CHECK (material_type IN ('BOOK', 'DOCUMENT'));

ALTER TABLE documents DROP CONSTRAINT documents_source_type;
ALTER TABLE documents ADD CONSTRAINT documents_source_type
    CHECK (source_type IN ('manual','txt','pdf','docx','epub','fb2','md'));

ALTER TABLE book_upload_sessions
    ADD COLUMN material_type VARCHAR(8) NOT NULL DEFAULT 'DOCUMENT';

UPDATE book_upload_sessions
SET material_type = 'BOOK'
WHERE format IN ('epub', 'fb2');

ALTER TABLE book_upload_sessions
    ADD CONSTRAINT book_upload_sessions_material_type_valid
    CHECK (material_type IN ('BOOK', 'DOCUMENT'));

ALTER TABLE book_upload_sessions DROP CONSTRAINT book_upload_sessions_format_check;
ALTER TABLE book_upload_sessions ADD CONSTRAINT book_upload_sessions_format_check
    CHECK (format IN ('txt','epub','fb2','pdf','docx','md'));

CREATE INDEX documents_user_material_created_idx
ON documents(user_id, material_type, created_at DESC, id);

CREATE TABLE material_contexts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    material_type VARCHAR(8) NOT NULL CHECK (material_type IN ('BOOK','DOCUMENT')),
    mode VARCHAR(32) NOT NULL CHECK (mode IN (
        'full_document','selected_sections','selected_fragment',
        'read_to_position','current_chapter','whole_book'
    )),
    title VARCHAR(200) NOT NULL,
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
    position_offset INTEGER,
    progress_percent NUMERIC(5,2),
    section_numbers VARCHAR(2000),
    content_snapshot TEXT NOT NULL,
    source_sha256 CHAR(64),
    source_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT material_contexts_position_nonnegative CHECK (position_offset IS NULL OR position_offset >= 0),
    CONSTRAINT material_contexts_progress_valid CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100)
);

CREATE INDEX material_contexts_material_created_idx
ON material_contexts(user_id, document_id, created_at DESC);

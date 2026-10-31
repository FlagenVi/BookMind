ALTER TABLE documents ADD COLUMN original_file BYTEA;
ALTER TABLE documents ADD COLUMN original_sha256 CHAR(64);
ALTER TABLE documents ADD COLUMN original_size BIGINT;

ALTER TABLE documents ADD CONSTRAINT documents_original_size_positive
CHECK (original_size IS NULL OR original_size > 0);

CREATE TABLE reading_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position_offset INTEGER NOT NULL DEFAULT 0 CHECK (position_offset >= 0),
    confirmed_offset INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_offset >= 0),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, document_id)
);

CREATE TABLE reader_bookmarks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position_offset INTEGER NOT NULL CHECK (position_offset >= 0),
    label VARCHAR(160),
    excerpt VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reader_bookmarks_document_idx
ON reader_bookmarks(user_id, document_id, position_offset);

CREATE TABLE reader_highlights (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
    color VARCHAR(16) NOT NULL DEFAULT 'yellow'
        CHECK (color IN ('yellow','green','blue','pink')),
    exact_text TEXT NOT NULL,
    note VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reader_highlights_document_idx
ON reader_highlights(user_id, document_id, start_offset);

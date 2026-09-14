CREATE TABLE document_jobs (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
    next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
    total_characters INTEGER NOT NULL CHECK (total_characters > 0),
    processed_parts INTEGER NOT NULL DEFAULT 0 CHECK (processed_parts >= 0),
    error_message VARCHAR(300),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (next_offset <= total_characters)
);
CREATE INDEX document_jobs_pending_idx ON document_jobs(updated_at) WHERE status IN ('queued','processing');
CREATE TABLE document_parts (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    part_number INTEGER NOT NULL,
    heading VARCHAR(300) NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (document_id, part_number),
    CHECK (end_offset > start_offset)
);

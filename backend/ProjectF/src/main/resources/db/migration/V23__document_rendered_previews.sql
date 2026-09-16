ALTER TABLE documents
    ADD COLUMN rendered_file BYTEA,
    ADD COLUMN rendered_media_type VARCHAR(100),
    ADD COLUMN rendered_at TIMESTAMP WITH TIME ZONE;

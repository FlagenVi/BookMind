ALTER TABLE summary_jobs
    ADD COLUMN scope_mode VARCHAR(24) NOT NULL DEFAULT 'whole',
    ADD COLUMN scope_section_number INTEGER NOT NULL DEFAULT -1;

ALTER TABLE summary_jobs
    ADD CONSTRAINT summary_jobs_scope_valid CHECK (
        (scope_mode = 'whole' AND scope_section_number = -1) OR
        (scope_mode IN ('chapter', 'through_chapter') AND scope_section_number >= 0)
    );

ALTER TABLE summary_jobs DROP CONSTRAINT summary_jobs_document_id_compression_level_key;
ALTER TABLE summary_jobs ADD CONSTRAINT summary_jobs_document_level_scope_key
    UNIQUE (document_id, compression_level, scope_mode, scope_section_number);

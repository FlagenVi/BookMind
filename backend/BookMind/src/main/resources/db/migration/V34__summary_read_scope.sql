-- 'read' summaries cover text only up to the reader's confirmed position.
-- scope_section_number stores that boundary, so every later position gets its own job
-- and earlier results stay in history.
ALTER TABLE summary_jobs DROP CONSTRAINT summary_jobs_scope_valid;
ALTER TABLE summary_jobs
    ADD CONSTRAINT summary_jobs_scope_valid CHECK (
        (scope_mode = 'whole' AND scope_section_number = -1) OR
        (scope_mode IN ('chapter', 'through_chapter') AND scope_section_number >= 0) OR
        (scope_mode = 'read' AND scope_section_number > 0)
    );

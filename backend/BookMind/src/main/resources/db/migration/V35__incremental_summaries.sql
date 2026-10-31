-- A 'read' summary may extend an earlier one instead of resending the whole read text.
-- The character counts let the interface and the thesis report how much input was saved.
ALTER TABLE summary_jobs
    ADD COLUMN incremental_base_id UUID REFERENCES summaries(id) ON DELETE SET NULL,
    ADD COLUMN input_characters INTEGER,
    ADD COLUMN source_characters INTEGER;

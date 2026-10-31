ALTER TABLE reading_progress
    ADD COLUMN section_number INTEGER;

ALTER TABLE reading_progress
    ADD COLUMN section_offset INTEGER NOT NULL DEFAULT 0;

ALTER TABLE reading_progress
    ADD CONSTRAINT reading_progress_section_number_valid
    CHECK (section_number IS NULL OR section_number >= -1);

ALTER TABLE reading_progress
    ADD CONSTRAINT reading_progress_section_offset_nonnegative
    CHECK (section_offset >= 0);

WITH anchors AS (
    SELECT progress.user_id,
           progress.document_id,
           section.section_number,
           GREATEST(0, progress.position_offset - section.start_offset) AS section_offset
    FROM reading_progress progress
    JOIN LATERAL (
        SELECT value.section_number, value.start_offset
        FROM reader_sections value
        WHERE value.document_id = progress.document_id
          AND progress.position_offset >= value.start_offset
        ORDER BY value.start_offset DESC
        LIMIT 1
    ) section ON TRUE
)
UPDATE reading_progress progress
SET section_number = anchors.section_number,
    section_offset = anchors.section_offset
FROM anchors
WHERE progress.user_id = anchors.user_id
  AND progress.document_id = anchors.document_id;

ALTER TABLE documents
    ALTER COLUMN reader_structure_version SET DEFAULT 4;

UPDATE documents
SET reader_structure_version = 3
WHERE source_type = 'epub';

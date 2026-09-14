ALTER TABLE reader_sections
    ADD COLUMN toc_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE reader_sections
    ADD CONSTRAINT reader_sections_toc_level_valid
    CHECK (toc_level BETWEEN 0 AND 12);

ALTER TABLE documents
    ADD COLUMN reader_structure_version INTEGER NOT NULL DEFAULT 2;

-- Existing EPUB files are rebuilt lazily on the next opening. Version 2 adds
-- EPUB 2 NCX titles and hierarchy without changing the extracted book text.
UPDATE documents
SET reader_structure_version = 1
WHERE source_type = 'epub';

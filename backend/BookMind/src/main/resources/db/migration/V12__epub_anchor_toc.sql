CREATE TABLE reader_toc_entries (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    entry_number INTEGER NOT NULL,
    title VARCHAR(500) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'main' CHECK (role IN ('main','auxiliary')),
    toc_level INTEGER NOT NULL DEFAULT 0 CHECK (toc_level BETWEEN 0 AND 12),
    position_offset INTEGER NOT NULL CHECK (position_offset >= 0),
    PRIMARY KEY (document_id, entry_number)
);

ALTER TABLE documents
    ALTER COLUMN reader_structure_version SET DEFAULT 3;

UPDATE documents
SET reader_structure_version = 2
WHERE source_type = 'epub';

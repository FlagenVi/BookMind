ALTER TABLE documents ADD COLUMN author VARCHAR(500);

CREATE TABLE reader_sections (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    section_number INTEGER NOT NULL,
    title VARCHAR(500) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'main' CHECK (role IN ('main','auxiliary')),
    source_path VARCHAR(1000),
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
    content TEXT NOT NULL,
    PRIMARY KEY (document_id, section_number)
);

CREATE TABLE book_assets (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_path VARCHAR(1000) NOT NULL,
    media_type VARCHAR(100) NOT NULL,
    content BYTEA NOT NULL,
    is_cover BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (document_id, source_path)
);
CREATE INDEX book_assets_document_idx ON book_assets(document_id);
CREATE INDEX book_assets_cover_idx ON book_assets(document_id) WHERE is_cover;

CREATE TABLE reader_section_assets (
    document_id UUID NOT NULL,
    section_number INTEGER NOT NULL,
    asset_id UUID NOT NULL REFERENCES book_assets(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL CHECK (order_index >= 0),
    PRIMARY KEY (document_id, section_number, asset_id),
    FOREIGN KEY (document_id, section_number)
        REFERENCES reader_sections(document_id, section_number) ON DELETE CASCADE
);

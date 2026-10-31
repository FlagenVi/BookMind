ALTER TABLE documents DROP CONSTRAINT documents_source_type;
ALTER TABLE documents ADD CONSTRAINT documents_source_type
    CHECK (source_type IN ('manual','txt','pdf','docx','epub','fb2','md','novel'));

CREATE TABLE novel_chapters (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chapter_number INTEGER NOT NULL CHECK (chapter_number >= 0),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    source_format VARCHAR(10) NOT NULL CHECK (source_format IN ('txt','md','docx','html','xhtml','epub','fb2')),
    source_sha256 CHAR(64) NOT NULL,
    source_section_number INTEGER NOT NULL CHECK (source_section_number >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT novel_chapters_content_not_blank CHECK (length(trim(content)) > 0),
    CONSTRAINT novel_chapters_title_not_blank CHECK (length(trim(title)) > 0),
    UNIQUE (document_id, chapter_number),
    UNIQUE (document_id, source_sha256, source_section_number)
);
CREATE INDEX novel_chapters_document_idx ON novel_chapters(document_id, chapter_number);

ALTER TABLE reader_sections ADD COLUMN novel_chapter_id UUID REFERENCES novel_chapters(id) ON DELETE SET NULL;

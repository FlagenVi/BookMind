ALTER TABLE documents ADD COLUMN novel_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE summary_jobs ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE novel_chapters ADD COLUMN confirmed_offset INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_offset >= 0);

ALTER TABLE book_assets ADD COLUMN novel_chapter_id UUID REFERENCES novel_chapters(id) ON DELETE CASCADE;
ALTER TABLE book_assets ADD COLUMN novel_order_index INTEGER;
CREATE INDEX book_assets_novel_chapter_idx ON book_assets(novel_chapter_id, novel_order_index);

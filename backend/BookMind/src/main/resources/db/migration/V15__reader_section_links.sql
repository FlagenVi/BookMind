CREATE TABLE reader_section_links (
    document_id UUID NOT NULL,
    section_number INTEGER NOT NULL,
    link_number INTEGER NOT NULL CHECK (link_number >= 0),
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
    target_section_number INTEGER NOT NULL,
    target_section_offset INTEGER NOT NULL CHECK (target_section_offset >= 0),
    target_position_offset INTEGER NOT NULL CHECK (target_position_offset >= 0),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('internal','note')),
    PRIMARY KEY (document_id, section_number, link_number),
    FOREIGN KEY (document_id, section_number)
        REFERENCES reader_sections(document_id, section_number) ON DELETE CASCADE,
    FOREIGN KEY (document_id, target_section_number)
        REFERENCES reader_sections(document_id, section_number) ON DELETE CASCADE
);

CREATE INDEX reader_section_links_target_idx
    ON reader_section_links(document_id, target_section_number);

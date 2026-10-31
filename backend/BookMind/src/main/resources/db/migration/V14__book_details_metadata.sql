ALTER TABLE documents
    ADD COLUMN publisher VARCHAR(500),
    ADD COLUMN publication_date VARCHAR(255),
    ADD COLUMN language VARCHAR(100),
    ADD COLUMN description TEXT;

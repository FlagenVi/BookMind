ALTER TABLE documents
ADD COLUMN favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX documents_favorite_idx
ON documents(user_id, favorite) WHERE favorite;


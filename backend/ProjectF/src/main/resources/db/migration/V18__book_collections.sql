CREATE TABLE book_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT book_collections_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX book_collections_user_name_unique
ON book_collections(user_id, lower(trim(name)));

CREATE INDEX book_collections_user_updated_idx
ON book_collections(user_id, updated_at DESC, id);

CREATE TRIGGER book_collections_updated_at BEFORE UPDATE ON book_collections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE documents
ADD COLUMN collection_id UUID REFERENCES book_collections(id) ON DELETE SET NULL;

CREATE INDEX documents_collection_idx
ON documents(user_id, collection_id, updated_at DESC);

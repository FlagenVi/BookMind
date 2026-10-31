CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
    CONSTRAINT users_password_hash_not_blank CHECK (length(trim(password_hash)) > 0)
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(trim(email)));

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    original_text TEXT NOT NULL,
    source_type VARCHAR(10) NOT NULL DEFAULT 'manual',
    original_filename VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT documents_title_not_blank CHECK (length(trim(title)) > 0),
    CONSTRAINT documents_text_not_blank CHECK (length(trim(original_text)) > 0),
    CONSTRAINT documents_source_type CHECK (source_type IN ('manual', 'txt', 'pdf', 'docx'))
);

CREATE INDEX documents_user_created_idx ON documents (user_id, created_at DESC, id);

CREATE TABLE summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    compression_level VARCHAR(10) NOT NULL,
    compression_percent SMALLINT NOT NULL,
    algorithm VARCHAR(100) NOT NULL,
    model_name VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT summaries_text_not_blank CHECK (length(trim(summary_text)) > 0),
    CONSTRAINT summaries_compression_level CHECK (compression_level IN ('short', 'medium', 'detailed')),
    CONSTRAINT summaries_compression_percent CHECK (compression_percent BETWEEN 1 AND 100),
    CONSTRAINT summaries_algorithm_not_blank CHECK (length(trim(algorithm)) > 0)
);

CREATE INDEX summaries_document_created_idx ON summaries (document_id, created_at DESC, id);

-- Keep modification timestamps correct for both JPA and direct SQL updates.
CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

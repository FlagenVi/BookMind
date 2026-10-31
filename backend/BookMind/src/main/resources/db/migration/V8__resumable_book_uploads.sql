CREATE TABLE book_upload_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    title VARCHAR(200) NOT NULL,
    format VARCHAR(10) NOT NULL CHECK (format IN ('txt','epub','fb2','pdf','docx')),
    expected_size INTEGER NOT NULL CHECK (expected_size > 0 AND expected_size <= 31457280),
    confirmed_offset INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_offset >= 0),
    uploaded_bytes BYTEA NOT NULL DEFAULT ''::bytea,
    status VARCHAR(16) NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','completed','failed')),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',
    CHECK (confirmed_offset <= expected_size)
);
CREATE INDEX book_upload_sessions_expiry_idx ON book_upload_sessions(expires_at)
WHERE status = 'uploading';

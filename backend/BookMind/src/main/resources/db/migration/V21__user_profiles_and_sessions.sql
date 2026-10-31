ALTER TABLE users
    ADD COLUMN display_name VARCHAR(80),
    ADD COLUMN bio VARCHAR(500),
    ADD COLUMN avatar_data BYTEA,
    ADD COLUMN avatar_content_type VARCHAR(40);

ALTER TABLE users
    ADD CONSTRAINT users_display_name_not_blank
        CHECK (display_name IS NULL OR length(trim(display_name)) > 0),
    ADD CONSTRAINT users_avatar_complete
        CHECK ((avatar_data IS NULL) = (avatar_content_type IS NULL)),
    ADD CONSTRAINT users_avatar_size
        CHECK (avatar_data IS NULL OR octet_length(avatar_data) <= 2097152),
    ADD CONSTRAINT users_avatar_content_type
        CHECK (avatar_content_type IS NULL OR avatar_content_type IN ('image/jpeg', 'image/png', 'image/webp'));

CREATE TABLE user_sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX user_sessions_user_created_idx ON user_sessions (user_id, created_at DESC);

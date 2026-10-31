ALTER TABLE users
    ADD COLUMN username VARCHAR(24),
    ADD COLUMN profile_visibility VARCHAR(12) NOT NULL DEFAULT 'private',
    ADD COLUMN show_library BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN show_statistics BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN show_activity BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN show_friends BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD CONSTRAINT users_username_format
    CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,23}$');
ALTER TABLE users ADD CONSTRAINT users_profile_visibility
    CHECK (profile_visibility IN ('public', 'friends', 'private'));
CREATE UNIQUE INDEX users_username_unique ON users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE profile_genres (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    genre VARCHAR(60) NOT NULL,
    position SMALLINT NOT NULL,
    PRIMARY KEY (user_id, position),
    UNIQUE (user_id, genre)
);

CREATE TABLE profile_featured_books (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position SMALLINT NOT NULL,
    PRIMARY KEY (user_id, document_id),
    UNIQUE (user_id, position)
);

CREATE TABLE friend_connections (
    user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_low, user_high),
    CHECK (user_low <> user_high),
    CHECK (requested_by IN (user_low, user_high))
);
CREATE INDEX friend_connections_high_idx ON friend_connections(user_high, status);

CREATE TABLE user_blocks (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, blocked_id),
    CHECK (user_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_id, user_id);

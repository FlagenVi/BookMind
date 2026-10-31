CREATE TABLE social_conversations (
    id UUID PRIMARY KEY,
    user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_low, user_high),
    CHECK (user_low <> user_high)
);
CREATE INDEX social_conversations_high ON social_conversations(user_high, updated_at DESC);
CREATE INDEX social_conversations_low ON social_conversations(user_low, updated_at DESC);

CREATE TABLE social_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES social_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    body VARCHAR(4000) NOT NULL DEFAULT '',
    reply_to BIGINT REFERENCES social_messages(id) ON DELETE SET NULL,
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    book_title VARCHAR(200),
    book_author VARCHAR(255),
    quote_text TEXT CHECK (char_length(quote_text) <= 10000),
    spoiler BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (sender_id, client_id),
    CHECK (btrim(body) <> '' OR book_title IS NOT NULL OR deleted_at IS NOT NULL),
    CHECK (quote_text IS NULL OR book_title IS NOT NULL)
);
CREATE INDEX social_messages_history ON social_messages(conversation_id, id DESC);
CREATE INDEX social_messages_sender_time ON social_messages(sender_id, created_at DESC);
CREATE TABLE social_reads (
    conversation_id UUID NOT NULL REFERENCES social_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id BIGINT NOT NULL DEFAULT 0 CHECK (last_read_id >= 0),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE social_notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    messages BOOLEAN NOT NULL DEFAULT TRUE,
    friends BOOLEAN NOT NULL DEFAULT TRUE,
    paused BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE social_notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('message','friend_request','friend_accepted')),
    event_key VARCHAR(100) NOT NULL,
    conversation_id UUID REFERENCES social_conversations(id) ON DELETE CASCADE,
    seen BOOLEAN NOT NULL DEFAULT FALSE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, kind, event_key)
);
CREATE INDEX social_notifications_inbox ON social_notifications(user_id, occurred_at DESC);
CREATE TABLE social_rate_limits (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(24) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, action)
);

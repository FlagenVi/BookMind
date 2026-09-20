CREATE TABLE book_chat_threads (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX book_chat_threads_book_idx
    ON book_chat_threads(user_id, document_id, updated_at DESC);

CREATE TABLE book_chat_turns (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES book_chat_threads(id) ON DELETE CASCADE,
    mode VARCHAR(24) NOT NULL CHECK (mode IN ('grounded', 'model_knowledge')),
    model_name VARCHAR(80) NOT NULL,
    question VARCHAR(2000) NOT NULL,
    answer TEXT,
    status VARCHAR(12) NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
    error_message VARCHAR(500),
    position_offset INTEGER,
    source_sha256 CHAR(64),
    source_updated_at TIMESTAMPTZ,
    source_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_excerpt TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX book_chat_turns_thread_idx
    ON book_chat_turns(thread_id, created_at, id);
CREATE UNIQUE INDEX book_chat_one_pending_turn_idx
    ON book_chat_turns(thread_id) WHERE status = 'pending';

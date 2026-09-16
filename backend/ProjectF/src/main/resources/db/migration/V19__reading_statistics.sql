CREATE TABLE reading_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    start_offset INTEGER NOT NULL DEFAULT 0,
    end_offset INTEGER NOT NULL DEFAULT 0,
    last_confirmed_offset INTEGER NOT NULL DEFAULT 0,
    characters_read BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT reading_sessions_duration_nonnegative CHECK (duration_seconds >= 0),
    CONSTRAINT reading_sessions_offsets_nonnegative CHECK (
        start_offset >= 0 AND end_offset >= 0 AND last_confirmed_offset >= 0
    ),
    CONSTRAINT reading_sessions_characters_nonnegative CHECK (characters_read >= 0),
    CONSTRAINT reading_sessions_dates_valid CHECK (ended_at >= started_at)
);

CREATE INDEX reading_sessions_user_ended_idx
ON reading_sessions(user_id, ended_at DESC);

CREATE INDEX reading_sessions_document_ended_idx
ON reading_sessions(user_id, document_id, ended_at DESC);

CREATE TABLE reading_goals (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_minutes SMALLINT NOT NULL DEFAULT 20,
    monthly_books SMALLINT NOT NULL DEFAULT 2,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reading_goals_daily_valid CHECK (daily_minutes BETWEEN 0 AND 1440),
    CONSTRAINT reading_goals_monthly_valid CHECK (monthly_books BETWEEN 0 AND 100)
);

CREATE TRIGGER reading_goals_updated_at BEFORE UPDATE ON reading_goals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE documents
ADD COLUMN finished_at TIMESTAMPTZ;

UPDATE documents
SET finished_at = updated_at
WHERE library_status = 'finished';

CREATE INDEX documents_user_finished_idx
ON documents(user_id, finished_at DESC) WHERE finished_at IS NOT NULL;

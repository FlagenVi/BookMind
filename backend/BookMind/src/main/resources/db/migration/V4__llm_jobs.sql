CREATE TABLE summary_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 compression_level VARCHAR(10) NOT NULL CHECK(compression_level IN ('short','medium','detailed')),
 model_name VARCHAR(200) NOT NULL,
 status VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting','failed','ready')),
 round_number INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 tokens_used BIGINT NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 error_message VARCHAR(300),
 result_id UUID REFERENCES summaries(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(document_id,compression_level)
);
CREATE TABLE summary_steps (
 job_id UUID NOT NULL REFERENCES summary_jobs(id) ON DELETE CASCADE,
 round_number INTEGER NOT NULL,
 step_number INTEGER NOT NULL,
 input_text TEXT NOT NULL,
 output_text TEXT,
 PRIMARY KEY(job_id,round_number,step_number)
);
CREATE TABLE llm_throttle (
 id INTEGER PRIMARY KEY CHECK(id=1),
 next_call_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO llm_throttle(id) VALUES(1);

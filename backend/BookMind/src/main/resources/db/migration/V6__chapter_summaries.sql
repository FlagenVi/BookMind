ALTER TABLE summary_jobs ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE summary_steps ADD COLUMN section_number INTEGER NOT NULL DEFAULT -1;
ALTER TABLE summary_steps ADD COLUMN repair_text TEXT;
CREATE TABLE summary_sections (
 job_id UUID NOT NULL REFERENCES summary_jobs(id) ON DELETE CASCADE,
 section_number INTEGER NOT NULL,
 heading VARCHAR(300) NOT NULL,
 category VARCHAR(20) NOT NULL,
 summary_text TEXT,
 PRIMARY KEY(job_id,section_number)
);

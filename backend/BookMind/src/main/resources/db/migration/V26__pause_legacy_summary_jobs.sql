-- Do not resume paid requests unexpectedly after changing the summary pipeline.
UPDATE summary_jobs
SET status = 'failed',
    error_message = 'Обработка остановлена после обновления. Продолжите её вручную.',
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('queued', 'running', 'waiting');

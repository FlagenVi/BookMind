DELETE FROM reader_highlights
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               row_number() OVER (
                   PARTITION BY user_id, document_id, start_offset, end_offset
                   ORDER BY created_at, id
               ) AS duplicate_number
        FROM reader_highlights
    ) duplicates
    WHERE duplicate_number > 1
);

CREATE UNIQUE INDEX reader_highlights_unique_range_idx
ON reader_highlights(user_id, document_id, start_offset, end_offset);

-- failed jobs from before 0019 kept the default retryable = true even when the
-- source was not a readable video. mark those final, matching the texts in
-- UNREADABLE_SOURCE_TEXTS (src/transcode/source-errors.ts; a test keeps the two
-- equal). an update of matching rows only, so the table is not rewritten.
UPDATE "processing_jobs"
SET "retryable" = false
WHERE "status" = 'failed'
  AND "retryable"
  AND (
    strpos("error_message", 'Invalid data found when processing input') > 0
    OR strpos("error_message", 'No video stream found') > 0
  );

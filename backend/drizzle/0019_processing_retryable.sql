-- a constant default is stored once in the catalog, so existing rows are not rewritten
ALTER TABLE "processing_jobs" ADD COLUMN "retryable" boolean DEFAULT true NOT NULL;

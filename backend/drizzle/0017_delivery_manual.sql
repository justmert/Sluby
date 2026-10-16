-- a constant default is stored once in the catalog, so existing rows are not rewritten
ALTER TABLE "webhook_deliveries" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;

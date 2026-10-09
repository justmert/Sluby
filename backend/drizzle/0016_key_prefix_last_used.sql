ALTER TABLE "api_keys" ADD COLUMN "prefix" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_at" timestamp with time zone;
ALTER TABLE "video_assets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "video_assets_deleted_at_idx" ON "video_assets" USING btree ("deleted_at");
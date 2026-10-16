-- drizzle runs every pending migration in one transaction, so these indexes
-- cannot be built concurrently: each create index holds a share lock on its
-- table (reads go on, writes wait) until the migration run commits, and the type
-- change rewrites video_assets under an access exclusive lock, rounding
-- created_at to milliseconds. with 210k assets, 220k upload sessions and 300k
-- webhook deliveries the statements took 2.4 s, 1.6 s of it the rewrite.
ALTER TABLE "video_assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "video_assets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "api_keys_replaced_by_id_idx" ON "api_keys" USING btree ("replaced_by_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_video_asset_id_idx" ON "upload_sessions" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_file_path_idx" ON "upload_sessions" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX "video_assets_owner_listing_idx" ON "video_assets" USING btree ("creator_address","created_at","id") WHERE "video_assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_created_at_idx" ON "webhook_deliveries" USING btree ("webhook_endpoint_id","created_at");
ALTER TYPE "public"."reconcile_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "error_message" text;--> statement-breakpoint
CREATE INDEX "api_keys_creator_address_idx" ON "api_keys" USING btree ("creator_address");--> statement-breakpoint
CREATE INDEX "artifacts_video_asset_id_idx" ON "artifacts" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "artifacts_rendition_id_idx" ON "artifacts" USING btree ("rendition_id");--> statement-breakpoint
CREATE INDEX "artifacts_object_id_idx" ON "artifacts" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "playback_ids_video_asset_id_idx" ON "playback_ids" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_video_asset_id_idx" ON "processing_jobs" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_upload_session_id_idx" ON "processing_jobs" USING btree ("upload_session_id");--> statement-breakpoint
CREATE INDEX "renditions_video_asset_id_idx" ON "renditions" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "video_assets_creator_address_idx" ON "video_assets" USING btree ("creator_address");--> statement-breakpoint
CREATE INDEX "video_assets_status_idx" ON "video_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "video_assets_created_at_id_idx" ON "video_assets" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_api_key_id_idx" ON "webhook_endpoints" USING btree ("api_key_id");
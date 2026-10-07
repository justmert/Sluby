CREATE TYPE "public"."pending_object_state" AS ENUM('uploading', 'release');--> statement-breakpoint
CREATE TABLE "pending_objects" (
	"object_id" text PRIMARY KEY NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"run_key" text NOT NULL,
	"state" "pending_object_state" DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_objects_video_asset_id_idx" ON "pending_objects" USING btree ("video_asset_id");--> statement-breakpoint
CREATE INDEX "pending_objects_state_idx" ON "pending_objects" USING btree ("state");--> statement-breakpoint
ALTER TABLE "processing_jobs" DROP COLUMN "max_retries";
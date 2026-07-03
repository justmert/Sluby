CREATE TYPE "public"."playback_policy" AS ENUM('public', 'signed');--> statement-breakpoint
CREATE TYPE "public"."reconcile_status" AS ENUM('ok', 'drift');--> statement-breakpoint
CREATE TABLE "playback_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playback_id" text NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"policy" "playback_policy" DEFAULT 'public' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_ids_playback_id_unique" UNIQUE("playback_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" "reconcile_status" NOT NULL,
	"db_object_count" integer DEFAULT 0 NOT NULL,
	"indexer_object_count" integer DEFAULT 0 NOT NULL,
	"in_sync_count" integer DEFAULT 0 NOT NULL,
	"orphan_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"orphaned_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playback_ids" ADD CONSTRAINT "playback_ids_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;
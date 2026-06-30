CREATE TYPE "public"."artifact_role" AS ENUM('master_manifest', 'variant_playlist', 'rendition_data', 'thumbnail');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"rendition_id" uuid,
	"role" "artifact_role" NOT NULL,
	"object_id" text NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"width" integer,
	"height" integer,
	"video_bitrate_kbps" integer,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"data_object_id" text NOT NULL,
	"playlist_object_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_rendition_id_renditions_id_fk" FOREIGN KEY ("rendition_id") REFERENCES "public"."renditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renditions" ADD CONSTRAINT "renditions_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;
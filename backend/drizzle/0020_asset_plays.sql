CREATE TABLE "asset_plays_daily" (
	"video_asset_id" uuid NOT NULL,
	"day" date NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_plays_daily_video_asset_id_day_pk" PRIMARY KEY("video_asset_id","day")
);
--> statement-breakpoint
ALTER TABLE "video_assets" ADD COLUMN "last_played_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_plays_daily" ADD CONSTRAINT "asset_plays_daily_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;
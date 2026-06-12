CREATE TABLE "allowlist_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allowlist_id" uuid NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sui_object_id" text,
	"creator_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowlists_sui_object_id_unique" UNIQUE("sui_object_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_address" text NOT NULL,
	"creator_address" text NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"duration_days" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sui_object_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_sui_object_id_unique" UNIQUE("sui_object_id")
);
--> statement-breakpoint
CREATE TABLE "viewing_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_address" text NOT NULL,
	"video_asset_id" uuid NOT NULL,
	"creator_address" text NOT NULL,
	"sui_object_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viewing_tickets_sui_object_id_unique" UNIQUE("sui_object_id")
);
--> statement-breakpoint
ALTER TABLE "allowlist_members" ADD CONSTRAINT "allowlist_members_allowlist_id_allowlists_id_fk" FOREIGN KEY ("allowlist_id") REFERENCES "public"."allowlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowlists" ADD CONSTRAINT "allowlists_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewing_tickets" ADD CONSTRAINT "viewing_tickets_video_asset_id_video_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."video_assets"("id") ON DELETE cascade ON UPDATE no action;
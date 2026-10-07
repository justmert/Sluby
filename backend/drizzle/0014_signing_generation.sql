-- signed urls now carry the asset's signing generation and a key derived for
-- them alone. urls signed before this version used the session secret over
-- just the object id and expiry, with no lifetime cap. they keep working for
-- six hours (the new cap) after this migration, never past their own expiry,
-- and stop at once when the asset's generation is first raised. the window is
-- the column's default while it is added, which postgres stores once instead
-- of rewriting the table; rows created later get null (no legacy urls).
ALTER TABLE "video_assets" ADD COLUMN "signing_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_assets" ADD COLUMN "legacy_signatures_until" timestamp with time zone DEFAULT (now() + interval '6 hours');--> statement-breakpoint
ALTER TABLE "video_assets" ALTER COLUMN "legacy_signatures_until" DROP DEFAULT;

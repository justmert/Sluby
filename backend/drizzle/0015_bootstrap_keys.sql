CREATE TABLE "bootstrap_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- bootstrap keys seeded by earlier versions count as seeded, so deleting them now sticks
INSERT INTO "bootstrap_keys" ("key_hash", "seeded_at")
SELECT "key_hash", "created_at" FROM "api_keys"
WHERE "creator_address" = 'platform' AND "name" = 'bootstrap';

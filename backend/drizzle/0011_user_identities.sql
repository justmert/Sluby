CREATE TABLE "allowlist_pins" (
	"provider" text NOT NULL,
	"entry" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowlist_pins_provider_entry_pk" PRIMARY KEY("provider","entry")
);
--> statement-breakpoint
CREATE TABLE "legacy_owner_claims" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- sessions were keyed on a github login, which no longer names an account:
-- end them all, so each person signs in once more and that sign-in links
-- their account and claims their data
DELETE FROM "studio_sessions";--> statement-breakpoint
ALTER TABLE "studio_sessions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_sessions" ADD COLUMN "identity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "legacy_owner_claims" ADD CONSTRAINT "legacy_owner_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allowlist_pins_provider_subject_idx" ON "allowlist_pins" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "legacy_owner_claims_user_id_idx" ON "legacy_owner_claims" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_identity_id_user_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."user_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_sessions_user_id_idx" ON "studio_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "studio_sessions_identity_id_idx" ON "studio_sessions" USING btree ("identity_id");;--> statement-breakpoint
-- older versions ran AUTH_DISABLED as github:dev, the same address a real
-- github user named dev gets. give that data to a local dev account and claim
-- the address for it, so no github sign-in can ever take it over
DO $$
DECLARE
  dev uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "video_assets" WHERE "creator_address" = 'github:dev')
    OR EXISTS (SELECT 1 FROM "api_keys" WHERE "creator_address" = 'github:dev')
    OR EXISTS (SELECT 1 FROM "webhook_endpoints" WHERE "creator_address" = 'github:dev')
    OR EXISTS (SELECT 1 FROM "upload_sessions" WHERE "metadata"->>'creatorAddress' = 'github:dev')
  THEN
    INSERT INTO "users" ("display_name") VALUES ('Local developer') RETURNING "id" INTO dev;
    INSERT INTO "user_identities" ("user_id", "provider", "subject", "username")
      VALUES (dev, 'local', 'dev', 'dev');
    INSERT INTO "legacy_owner_claims" ("address", "user_id") VALUES ('github:dev', dev);
    UPDATE "video_assets" SET "creator_address" = 'user:' || dev
      WHERE "creator_address" = 'github:dev';
    UPDATE "api_keys" SET "creator_address" = 'user:' || dev
      WHERE "creator_address" = 'github:dev';
    UPDATE "webhook_endpoints" SET "creator_address" = 'user:' || dev
      WHERE "creator_address" = 'github:dev';
    UPDATE "upload_sessions"
      SET "metadata" = jsonb_set("metadata", '{creatorAddress}', to_jsonb('user:' || dev))
      WHERE "metadata"->>'creatorAddress' = 'github:dev';
  END IF;
END $$;

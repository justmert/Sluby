CREATE TABLE "instance_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"role" text,
	"user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_kind_check" CHECK ("invites"."kind" in ('invite', 'reset')),
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" is null or "invites"."role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_credentials_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "legacy_owner_claims" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "legacy_owner_claims" CASCADE;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_kind_expires_at_idx" ON "invites" USING btree ("kind","expires_at");--> statement-breakpoint
CREATE INDEX "invites_user_id_idx" ON "invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invites_created_by_idx" ON "invites" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'member'));;--> statement-breakpoint
-- a key made by an account keeps a link to it, so the key acts with that
-- member's role and stops while they are removed. other owners (github:<login>,
-- platform, the zero address) never named an account, so their keys have no
-- creator and act as admin, as keys made from the server do
UPDATE "api_keys" AS k SET "created_by" = u."id"
  FROM "users" AS u
  WHERE k."creator_address" ~ '^user:[0-9a-f-]{36}$'
    AND u."id"::text = substring(k."creator_address" FROM 6);--> statement-breakpoint
-- a key with no creator acts as admin, which is right for keys made from the
-- server (platform, the zero address) but would promote keys an ordinary
-- person once held: one whose account no longer exists, or a github:<login>
-- key nobody claimed. those stop instead; an admin makes new ones
UPDATE "api_keys" SET "is_active" = false
  WHERE "created_by" IS NULL
    AND ("creator_address" ~ '^user:' OR "creator_address" LIKE 'github:%');--> statement-breakpoint
-- one install is one team: everything belongs to the workspace, so the owner
-- scoped queries keep working and every member sees every row
UPDATE "video_assets" SET "creator_address" = 'workspace'
  WHERE "creator_address" <> 'workspace';--> statement-breakpoint
UPDATE "api_keys" SET "creator_address" = 'workspace'
  WHERE "creator_address" <> 'workspace';--> statement-breakpoint
UPDATE "webhook_endpoints" SET "creator_address" = 'workspace'
  WHERE "creator_address" <> 'workspace';--> statement-breakpoint
UPDATE "upload_sessions"
  SET "metadata" = jsonb_set("metadata", '{creatorAddress}', '"workspace"')
  WHERE "metadata" ? 'creatorAddress'
    AND "metadata"->>'creatorAddress' IS DISTINCT FROM 'workspace';--> statement-breakpoint
-- the AUTH_DISABLED account runs a local install with no sign-in, where the
-- one person at the keyboard can do everything
UPDATE "users" SET "role" = 'admin'
  WHERE "id" IN (
    SELECT "user_id" FROM "user_identities" WHERE "provider" = 'local' AND "subject" = 'dev'
  );

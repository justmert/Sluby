ALTER TABLE "invites" ADD COLUMN "max_uses" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- every link before this was single use, so a used one was used once
UPDATE "invites" SET "use_count" = 1 WHERE "used_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_max_uses_check" CHECK ("invites"."max_uses" is null or "invites"."max_uses" >= 1);--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_multi_use_check" CHECK (coalesce("invites"."max_uses", 0) = 1 or ("invites"."kind" = 'invite' and "invites"."role" = 'member'));
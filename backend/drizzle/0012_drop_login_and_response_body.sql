DROP INDEX "studio_sessions_login_idx";--> statement-breakpoint
ALTER TABLE "studio_sessions" DROP COLUMN "login";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN "response_body";
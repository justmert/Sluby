ALTER TABLE "webhook_endpoints" DROP CONSTRAINT "webhook_endpoints_api_key_id_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ALTER COLUMN "api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "creator_address" text;--> statement-breakpoint
-- existing endpoints belong to whoever owns the key that registered them
UPDATE "webhook_endpoints" AS w SET "creator_address" = k."creator_address" FROM "api_keys" AS k WHERE w."api_key_id" = k."id";--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ALTER COLUMN "creator_address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_endpoints_creator_address_idx" ON "webhook_endpoints" USING btree ("creator_address");
-- reconciliation keeps a copy of the indexer's inventory and the feed cursor
-- it read up to, so a run reads only the events since the last one. both
-- tables start empty: the first run after the upgrade reads the whole feed,
-- as every run did before. the index on reconciliation_runs is built under a
-- share lock, on a table of one row per run (2000 rows took 5 ms).
CREATE TABLE "indexer_objects" (
	"object_id" text PRIMARY KEY NOT NULL,
	"deleted" boolean NOT NULL,
	"event_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconcile_feed" (
	"feed" text PRIMARY KEY NOT NULL,
	"cursor_id" text,
	"cursor_after" timestamp (3) with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reconciliation_runs_finished_at_idx" ON "reconciliation_runs" USING btree ("finished_at");
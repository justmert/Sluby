-- SiaStream migration
-- Rename blob columns to object columns
ALTER TABLE video_assets RENAME COLUMN manifest_blob_id TO manifest_object_id;
ALTER TABLE video_assets RENAME COLUMN thumbnail_blob_ids TO thumbnail_object_ids;

-- Remove Sia/Seal columns
ALTER TABLE video_assets DROP COLUMN IF EXISTS sui_object_id;
ALTER TABLE video_assets DROP COLUMN IF EXISTS seal_policy_id;

-- Add sia_object_ids for cleanup tracking
ALTER TABLE video_assets ADD COLUMN IF NOT EXISTS sia_object_ids jsonb DEFAULT '[]'::jsonb;

-- Remove sui_object_id from access control tables
ALTER TABLE allowlists DROP COLUMN IF EXISTS sui_object_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS sui_object_id;
ALTER TABLE viewing_tickets DROP COLUMN IF EXISTS sui_object_id;

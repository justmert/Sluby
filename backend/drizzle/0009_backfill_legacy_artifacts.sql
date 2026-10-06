-- assets stored before the artifacts table existed (and finalize jobs queued
-- by those versions) carry their object ids only in manifest_object_id,
-- thumbnail_object_ids and sia_object_ids. give every such id its artifacts
-- row, so artifacts alone holds every object id of every asset: the master
-- and thumbnails keep their role, the rest of sia_object_ids (playlists and
-- data files, which the row cannot tell apart) get a null role. the rows are
-- dated by their asset, soft-deleted assets are included because deletion
-- still has to unpin their objects, and ids that already have a row for the
-- same asset are skipped, so running it on a current database adds nothing.
-- inserting into artifacts takes only a row exclusive lock; with 10k legacy
-- assets beside 1M current artifacts the 40k rows took about 7 s.
ALTER TABLE "artifacts" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
INSERT INTO "artifacts" ("video_asset_id", "rendition_id", "role", "object_id", "byte_size", "created_at")
SELECT DISTINCT ON (l.video_asset_id, l.object_id)
  l.video_asset_id, NULL, l.role, l.object_id, 0, l.created_at
FROM (
  SELECT v.id AS video_asset_id, v.created_at, 'master_manifest'::artifact_role AS role,
    v.manifest_object_id AS object_id, 1 AS rank
  FROM "video_assets" v
  UNION ALL
  SELECT v.id, v.created_at, 'thumbnail'::artifact_role, t.id, 2
  FROM "video_assets" v CROSS JOIN LATERAL unnest(v.thumbnail_object_ids) AS t(id)
  UNION ALL
  SELECT v.id, v.created_at, NULL::artifact_role, s.id, 3
  FROM "video_assets" v CROSS JOIN LATERAL jsonb_array_elements_text(v.sia_object_ids) AS s(id)
  WHERE jsonb_typeof(v.sia_object_ids) = 'array'
) l
WHERE l.object_id IS NOT NULL AND l.object_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "artifacts" a
    WHERE a.video_asset_id = l.video_asset_id AND a.object_id = l.object_id
  )
ORDER BY l.video_asset_id, l.object_id, l.rank;

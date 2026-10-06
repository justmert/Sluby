import { desc, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { reconciliationRuns, artifacts, videoAssets, type ReconciliationRun } from '../schema.js';
import type { ReconciliationSummary } from '../../reconcile/reconciler.js';

/** Persist a completed reconciliation run. */
export async function recordReconciliationRun(summary: ReconciliationSummary): Promise<void> {
  await db.insert(reconciliationRuns).values({
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    status: summary.status,
    dbObjectCount: summary.dbObjectCount,
    indexerObjectCount: summary.indexerObjectCount,
    inSyncCount: summary.inSyncCount,
    orphanCount: summary.orphanCount,
    missingCount: summary.missingCount,
    orphanedIds: summary.orphanedIds,
    missingIds: summary.missingIds,
    errorMessage: summary.errorMessage ?? null,
  });
}

export async function getLatestReconciliationRun(): Promise<ReconciliationRun | undefined> {
  return db.query.reconciliationRuns.findFirst({
    orderBy: [desc(reconciliationRuns.finishedAt)],
  });
}

/**
 * Gather every Sia object id the database believes it has stored. The
 * `artifacts` table is authoritative (one row per stored object), but we
 * also fold in the denormalized ids on `video_assets` so assets that
 * predate artifact normalization are still covered. Empty/null ids are
 * dropped.
 */
export async function getAllTrackedObjectIds(): Promise<string[]> {
  const [artifactRows, assetRows] = await Promise.all([
    db.select({ objectId: artifacts.objectId }).from(artifacts),
    db
      .select({
        manifestObjectId: videoAssets.manifestObjectId,
        thumbnailObjectIds: videoAssets.thumbnailObjectIds,
        siaObjectIds: videoAssets.siaObjectIds,
      })
      .from(videoAssets),
  ]);

  const ids = new Set<string>();
  for (const row of artifactRows) {
    if (row.objectId) ids.add(row.objectId);
  }
  for (const row of assetRows) {
    if (row.manifestObjectId) ids.add(row.manifestObjectId);
    for (const t of row.thumbnailObjectIds ?? []) {
      if (t) ids.add(t);
    }
    for (const s of (row.siaObjectIds ?? []) as string[]) {
      if (s) ids.add(s);
    }
  }
  return [...ids];
}

/**
 * The subset of `ids` that belong to `owner`'s assets, in the order given.
 * Ownership comes from the same places the inventory reads (artifacts plus
 * the ids on video_assets), soft-deleted assets included, so a tenant sees
 * exactly the part of a run that was about their objects. The ids go in as
 * one jsonb parameter because a run's list can exceed postgres' bind limit.
 */
export async function filterObjectIdsOwnedBy(ids: string[], owner: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select owned.id from (
      select a.object_id as id
        from ${artifacts} a join ${videoAssets} v on v.id = a.video_asset_id
        where v.creator_address = ${owner}
      union
      select v.manifest_object_id from ${videoAssets} v
        where v.creator_address = ${owner} and v.manifest_object_id is not null
      union
      select unnest(v.thumbnail_object_ids) from ${videoAssets} v
        where v.creator_address = ${owner}
      union
      select jsonb_array_elements_text(v.sia_object_ids) from ${videoAssets} v
        where v.creator_address = ${owner} and jsonb_typeof(v.sia_object_ids) = 'array'
    ) owned
    where owned.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
  `);
  const owned = new Set(rows.map((r) => r.id));
  return ids.filter((id) => owned.has(id));
}

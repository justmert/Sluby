import { desc } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  reconciliationRuns,
  artifacts,
  videoAssets,
  type ReconciliationRun,
} from '../schema.js';
import type { ReconciliationSummary } from '../../reconcile/reconciler.js';

/** Persist a completed reconciliation run. */
export async function recordReconciliationRun(
  summary: ReconciliationSummary,
): Promise<void> {
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
  });
}

export async function getLatestReconciliationRun(): Promise<
  ReconciliationRun | undefined
> {
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

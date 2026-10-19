import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { artifacts, videoAssets } from '../schema.js';

export type AssetStatus = (typeof videoAssets.status.enumValues)[number];

export interface AssetStats {
  total: number;
  byStatus: Record<AssetStatus, number>;
  /**
   * Bytes the pipeline stored on Sia for these assets (before erasure coding).
   * Failed assets count too: only finalize records bytes, so a failed asset
   * with bytes failed after its objects were pinned and recorded, and they stay
   * pinned until it is retried or deleted.
   */
  storedBytes: number;
  /** Playable minutes live in ready assets, so only those count. */
  readyDurationMs: number;
  /**
   * Sia objects backing these assets: one artifacts row per stored object,
   * which since the legacy backfill covers the ids on the asset row as well.
   */
  objectCount: number;
}

const EMPTY_BY_STATUS = (): Record<AssetStatus, number> =>
  Object.fromEntries(videoAssets.status.enumValues.map((s) => [s, 0])) as Record<
    AssetStatus,
    number
  >;

/**
 * Library-wide totals for one owner (the workspace), or every owner when it
 * is undefined. Soft-deleted assets are excluded everywhere.
 */
export async function getAssetStats(owner?: string): Promise<AssetStats> {
  const scope: SQL[] = [isNull(videoAssets.deletedAt)];
  if (owner !== undefined) scope.push(eq(videoAssets.creatorAddress, owner));
  const where = and(...scope);

  const [statusRows, objectRows] = await Promise.all([
    db
      .select({
        status: videoAssets.status,
        count: sql<number>`count(*)::int`,
        storedBytes: sql<string>`coalesce(sum(${videoAssets.totalStorageBytes}), 0)`,
        durationMs: sql<string>`coalesce(sum(${videoAssets.durationMs}), 0)`,
      })
      .from(videoAssets)
      .where(where)
      .groupBy(videoAssets.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(artifacts)
      .innerJoin(videoAssets, eq(artifacts.videoAssetId, videoAssets.id))
      .where(where),
  ]);

  const byStatus = EMPTY_BY_STATUS();
  let total = 0;
  let storedBytes = 0;
  let readyDurationMs = 0;
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
    total += row.count;
    // sums of bigint columns come back as strings from postgres
    storedBytes += Number(row.storedBytes);
    if (row.status === 'ready') readyDurationMs = Number(row.durationMs);
  }

  return { total, byStatus, storedBytes, readyDurationMs, objectCount: objectRows[0]?.count ?? 0 };
}

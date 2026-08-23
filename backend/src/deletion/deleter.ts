/**
 * The deletion sequence, with its side effects injected so it is unit-testable
 * without Redis, Postgres, or a live indexer. The queue worker wires the real
 * Sia client + DB + cache into it.
 *
 * Order: unpin each object, record the ones that succeeded (so a retry or the
 * GC sweep re-drives only the remainder), evict them from the delivery cache,
 * prune slabs, and — only when every object was unpinned — remove the asset
 * row (cascading to renditions, artifacts, jobs, and playback ids).
 *
 * Unpinning is best-effort per object so one wedged host cannot block the
 * others, but if ANY object could not be unpinned the function throws WITHOUT
 * removing the row, so BullMQ retries and the GC sweep keep re-driving it until
 * the objects are actually gone. Nothing is silently orphaned.
 */
export interface DeletionDeps {
  deleteObject: (objectId: string) => Promise<void>;
  pruneSlabs: () => Promise<void>;
  /** Record unpinned objects so retries/GC converge on the remainder. */
  markUnpinned: (videoAssetId: string, objectIds: string[]) => Promise<void>;
  /** Drop unpinned objects from the delivery caches (LRU + tier). */
  evictCache: (objectIds: string[]) => void;
  removeAsset: (videoAssetId: string) => Promise<void>;
  logger: Pick<import('pino').Logger, 'info' | 'warn'>;
}

export interface DeletionJob {
  videoAssetId: string;
  objectIds: string[];
}

export interface DeletionResult {
  videoAssetId: string;
  unpinned: number;
  failed: string[];
}

export async function runAssetDeletion(
  deps: DeletionDeps,
  job: DeletionJob,
): Promise<DeletionResult> {
  const { videoAssetId, objectIds } = job;
  const unpinned: string[] = [];
  const failed: string[] = [];

  for (const objectId of objectIds) {
    try {
      await deps.deleteObject(objectId);
      unpinned.push(objectId);
    } catch (err) {
      failed.push(objectId);
      deps.logger.warn({ videoAssetId, objectId, err }, 'failed to unpin object during deletion');
    }
  }

  if (unpinned.length > 0) {
    deps.evictCache(unpinned);
    await deps.markUnpinned(videoAssetId, unpinned);
  }

  try {
    await deps.pruneSlabs();
  } catch (err) {
    deps.logger.warn({ videoAssetId, err }, 'pruneSlabs failed during deletion');
  }

  if (failed.length > 0) {
    // Keep the row (still soft-deleted) so BullMQ + the GC sweep re-drive the
    // remaining objects. markUnpinned already dropped the ones that succeeded,
    // so the next attempt only retries `failed`.
    deps.logger.warn(
      { videoAssetId, unpinned: unpinned.length, failedCount: failed.length },
      'some objects could not be unpinned; will retry',
    );
    throw new Error(
      `asset ${videoAssetId}: ${failed.length} object(s) failed to unpin (${unpinned.length} unpinned)`,
    );
  }

  await deps.removeAsset(videoAssetId);
  deps.logger.info(
    { videoAssetId, unpinned: unpinned.length },
    'asset deleted and objects unpinned',
  );
  return { videoAssetId, unpinned: unpinned.length, failed };
}

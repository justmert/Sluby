/**
 * The deletion sequence, with its side effects injected so it is unit-testable
 * without Redis, Postgres, or a live indexer. The queue worker wires the real
 * Sia client + DB + cache into it.
 *
 * Order: remove the source upload still on disk (a failed asset kept it for a
 * retry, or the upload was still in flight) and the transcode output, unpin
 * each object and record it right away (so a crash, a retry or the GC sweep
 * re-drives only the remainder), evict them from the delivery cache, prune
 * slabs, and, only when every object was unpinned, remove the asset row
 * (cascading to renditions, artifacts, jobs, and playback ids). An object
 * the indexer no longer has counts as unpinned (sia-client deleteObject), so
 * a deletion that crashed after an unpin still converges.
 *
 * Unpinning is best-effort per object so one wedged host cannot block the
 * others, but if ANY object could not be unpinned the function throws WITHOUT
 * removing the row, so BullMQ retries and the GC sweep keep re-driving it until
 * the objects are actually gone. Nothing is silently orphaned.
 */
export interface DeletionDeps {
  /** Resolves when the object is not pinned anymore, including when it was not found. */
  deleteObject: (objectId: string) => Promise<unknown>;
  pruneSlabs: () => Promise<unknown>;
  /** Record unpinned objects so retries/GC converge on the remainder. */
  markUnpinned: (videoAssetId: string, objectIds: string[]) => Promise<void>;
  /** Drop unpinned objects from the delivery caches (LRU + tier). */
  evictCache: (objectIds: string[]) => void;
  removeAsset: (videoAssetId: string) => Promise<void>;
  /** Delete the asset's source upload files. Logs file errors instead of throwing. */
  removeSources: (videoAssetId: string) => Promise<void>;
  /** Delete the asset's transcode output directory. */
  removeOutput: (videoAssetId: string) => Promise<void>;
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

  // before the row goes: the asset's upload sessions are how the files are found
  await deps.removeSources(videoAssetId);
  await deps.removeOutput(videoAssetId);

  for (const objectId of objectIds) {
    try {
      await deps.deleteObject(objectId);
    } catch (err) {
      failed.push(objectId);
      deps.logger.warn({ videoAssetId, objectId, err }, 'failed to unpin object during deletion');
      continue;
    }
    unpinned.push(objectId);
    deps.evictCache([objectId]);
    // recorded one by one, so a crash part way loses nothing
    await deps.markUnpinned(videoAssetId, [objectId]);
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

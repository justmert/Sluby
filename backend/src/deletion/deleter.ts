/**
 * The deletion sequence, with its side effects injected so it is unit-testable
 * without Redis, Postgres, or a live indexer. The queue worker wires the real
 * Sia client + DB into it.
 *
 * Order matters: every object is unpinned first, then slabs are pruned, and
 * only then is the asset row removed (which cascades to renditions, artifacts,
 * jobs, and playback ids). Unpinning is best-effort per object so one wedged
 * host cannot block the whole deletion; any object that could not be unpinned
 * is logged and left for the reconciliation worker to surface as an orphan,
 * rather than silently retried forever against the same dead host.
 */
export interface DeletionDeps {
  deleteObject: (objectId: string) => Promise<void>;
  pruneSlabs: () => Promise<void>;
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
  const failed: string[] = [];
  let unpinned = 0;

  for (const objectId of objectIds) {
    try {
      await deps.deleteObject(objectId);
      unpinned += 1;
    } catch (err) {
      failed.push(objectId);
      deps.logger.warn({ videoAssetId, objectId, err }, 'failed to unpin object during deletion');
    }
  }

  try {
    await deps.pruneSlabs();
  } catch (err) {
    deps.logger.warn({ videoAssetId, err }, 'pruneSlabs failed during deletion');
  }

  await deps.removeAsset(videoAssetId);

  if (failed.length > 0) {
    deps.logger.warn(
      { videoAssetId, unpinned, failedCount: failed.length, failed },
      'asset removed but some objects could not be unpinned; reconciliation will flag them as orphans',
    );
  } else {
    deps.logger.info({ videoAssetId, unpinned }, 'asset deleted and all objects unpinned');
  }

  return { videoAssetId, unpinned, failed };
}

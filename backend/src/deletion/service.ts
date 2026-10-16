/**
 * Orchestration for asset deletion, with dependencies injected so the
 * decision logic is unit-testable without the real DB or queue. `index.ts`
 * wires the concrete queries and queue in.
 *
 * The delete job carries only the asset id; the worker collects the object
 * ids fresh on every attempt, so as objects are unpinned (and their artifact
 * rows removed) a retry or GC re-drive naturally targets only the remainder.
 */

export interface DeleteAssetDeps {
  /** Soft-delete the asset (owner-scoped). Returns the row when it
   *  transitioned, undefined when it does not exist / is not owned / is
   *  already being deleted. */
  softDelete: (id: string, owner?: string) => Promise<{ id: string } | undefined>;
  /** Enqueue the async unpin-and-remove job. */
  enqueue: (videoAssetId: string) => Promise<void>;
}

/**
 * Build the `deleteAsset` handler the assets route calls. It soft-deletes the
 * asset (so it disappears from the API at once) and enqueues the async unpin.
 * Returns false when there was nothing to delete, so the route answers 404.
 */
export function buildDeleteAsset(deps: DeleteAssetDeps) {
  return async (id: string, owner?: string): Promise<boolean> => {
    const soft = await deps.softDelete(id, owner);
    if (!soft) return false;
    await deps.enqueue(id);
    return true;
  };
}

export interface DeletionGcDeps {
  /** Assets soft-deleted long enough ago that their worker should have run. */
  listPending: () => Promise<{ id: string }[]>;
  /** Whether a delete job for the asset is waiting, delayed or running. */
  deletionInFlight: (videoAssetId: string) => Promise<boolean>;
  /** Queue another delete; resolves to how often the asset has been re-driven, this one included. */
  redrive: (videoAssetId: string) => Promise<number>;
  /** Unpin the objects no run will promote and the ones marked for release. */
  releaseObjects: () => Promise<{ released: number; unpinned: number; failed: number }>;
  /** Remove transcode output nothing needs anymore; resolves to the directories removed. */
  sweepOutput: () => Promise<number>;
  logger: Pick<import('pino').Logger, 'info' | 'error'>;
}

/** Re-drives of one asset after which a failing deletion is logged as an error. */
export const REDRIVE_ALERT_AFTER = 5;

export interface DeletionGcResult {
  redriven: number;
  /** pending assets left alone because a delete job for them is still in flight */
  inFlight: number;
  released: number;
  unpinned: number;
  unpinFailed: number;
  outputRemoved: number;
}

/**
 * Build the GC sweep. It re-drives soft-deleted assets whose deletion never
 * finished (worker crashed, was offline, or an object host was down), but
 * not one whose delete job is still queued or running, so two deletions of
 * one asset never run at once. It also unpins pipeline objects nothing will
 * record (left by a crash or a failed run) and removes transcode output of
 * deleted or ready assets. Every part runs even when another fails; the
 * sweep then fails with the first error, so the job shows it.
 */
export function buildDeletionGc(deps: DeletionGcDeps) {
  return async (): Promise<DeletionGcResult> => {
    const result: DeletionGcResult = {
      redriven: 0,
      inFlight: 0,
      released: 0,
      unpinned: 0,
      unpinFailed: 0,
      outputRemoved: 0,
    };
    const errors: unknown[] = [];

    try {
      for (const { id } of await deps.listPending()) {
        if (await deps.deletionInFlight(id)) {
          result.inFlight++;
          continue;
        }
        const redrives = await deps.redrive(id);
        result.redriven++;
        if (redrives >= REDRIVE_ALERT_AFTER) {
          deps.logger.error(
            { videoAssetId: id, redrives },
            'Asset deletion keeps failing; check the deletion job errors',
          );
        }
      }
    } catch (err) {
      errors.push(err);
    }

    try {
      const objects = await deps.releaseObjects();
      result.released = objects.released;
      result.unpinned = objects.unpinned;
      result.unpinFailed = objects.failed;
    } catch (err) {
      errors.push(err);
    }

    try {
      result.outputRemoved = await deps.sweepOutput();
    } catch (err) {
      errors.push(err);
    }

    if (result.redriven + result.unpinned + result.outputRemoved > 0) {
      deps.logger.info(result, 'Deletion gc sweep');
    }
    if (errors.length > 0) throw errors[0];
    return result;
  };
}

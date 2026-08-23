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
  enqueue: (videoAssetId: string) => Promise<void>;
  logger: Pick<import('pino').Logger, 'info'>;
}

/**
 * Build the GC sweep that re-drives soft-deleted assets whose deletion never
 * finished (worker crashed, was offline, or an object host was down). It is
 * idempotent: enqueuing again just re-runs a best-effort unpin of whatever
 * objects remain.
 */
export function buildDeletionGc(deps: DeletionGcDeps) {
  return async (): Promise<number> => {
    const pending = await deps.listPending();
    for (const { id } of pending) {
      await deps.enqueue(id);
    }
    if (pending.length > 0) {
      deps.logger.info({ count: pending.length }, 're-drove stuck asset deletions');
    }
    return pending.length;
  };
}

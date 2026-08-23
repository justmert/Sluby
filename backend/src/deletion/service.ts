/**
 * Orchestration for asset deletion, with dependencies injected so the
 * decision logic is unit-testable without the real DB or queue. `index.ts`
 * wires the concrete queries and queue in.
 */

export interface DeleteAssetDeps {
  /** Soft-delete the asset (owner-scoped). Returns the row when it
   *  transitioned, undefined when it does not exist / is not owned / is
   *  already being deleted. */
  softDelete: (id: string, owner?: string) => Promise<{ id: string } | undefined>;
  /** Gather every Sia object id belonging to the asset. */
  collectObjectIds: (id: string) => Promise<string[]>;
  /** Enqueue the async unpin-and-remove job. */
  enqueue: (data: { videoAssetId: string; objectIds: string[] }) => Promise<void>;
}

/**
 * Build the `deleteAsset` handler the assets route calls. It soft-deletes the
 * asset (so it disappears from the API at once), captures its object ids while
 * the mapping still exists, and enqueues the async unpin. Returns false when
 * there was nothing to delete, so the route answers 404.
 */
export function buildDeleteAsset(deps: DeleteAssetDeps) {
  return async (id: string, owner?: string): Promise<boolean> => {
    const soft = await deps.softDelete(id, owner);
    if (!soft) return false;

    // Capture object ids AFTER the soft-delete succeeds (the row still exists)
    // so the payload carries them even once the row is cascade-removed.
    const objectIds = await deps.collectObjectIds(id);
    await deps.enqueue({ videoAssetId: id, objectIds });
    return true;
  };
}

export interface DeletionGcDeps {
  /** Assets soft-deleted long enough ago that their worker should have run. */
  listPending: () => Promise<{ id: string }[]>;
  collectObjectIds: (id: string) => Promise<string[]>;
  enqueue: (data: { videoAssetId: string; objectIds: string[] }) => Promise<void>;
  logger: Pick<import('pino').Logger, 'info'>;
}

/**
 * Build the GC sweep that re-drives soft-deleted assets whose deletion never
 * finished (worker crashed, was offline, or an object host was down). It is
 * idempotent: enqueuing again just re-runs a best-effort unpin.
 */
export function buildDeletionGc(deps: DeletionGcDeps) {
  return async (): Promise<number> => {
    const pending = await deps.listPending();
    for (const { id } of pending) {
      const objectIds = await deps.collectObjectIds(id);
      await deps.enqueue({ videoAssetId: id, objectIds });
    }
    if (pending.length > 0) {
      deps.logger.info({ count: pending.length }, 're-drove stuck asset deletions');
    }
    return pending.length;
  };
}

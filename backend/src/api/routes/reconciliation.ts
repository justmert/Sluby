import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';

export interface ReconciliationRunRecord {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  dbObjectCount: number;
  indexerObjectCount: number;
  inSyncCount: number;
  orphanCount: number;
  missingCount: number;
  orphanedIds: string[];
  missingIds: string[];
  createdAt: Date;
}

export interface ReconciliationRouteDeps {
  getLatestRun: () => Promise<ReconciliationRunRecord | null>;
  /** Enqueue an on-demand reconciliation pass. */
  triggerRun: () => Promise<void>;
}

function formatRun(r: ReconciliationRunRecord) {
  return {
    id: r.id,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt.toISOString(),
    status: r.status,
    db_object_count: r.dbObjectCount,
    indexer_object_count: r.indexerObjectCount,
    in_sync_count: r.inSyncCount,
    orphan_count: r.orphanCount,
    missing_count: r.missingCount,
    orphaned_ids: r.orphanedIds,
    missing_ids: r.missingIds,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Reconciliation reporting. Surfaces the latest background run comparing
 * PostgreSQL's tracked objects against the indexer's inventory, and lets an
 * operator trigger a run on demand. Read/trigger both require `manage`.
 */
export function createReconciliationRoutes(
  deps: ReconciliationRouteDeps,
): Router {
  const router = Router();

  /** GET /api/v1/reconciliation — latest completed run. */
  router.get('/reconciliation', requireScope('manage'), async (_req: Request, res: Response) => {
    const run = await deps.getLatestRun();
    if (!run) {
      throw new AppError(404, 'No reconciliation run has completed yet');
    }
    res.json(formatRun(run));
  });

  /** POST /api/v1/reconciliation/run — enqueue an on-demand run. */
  router.post(
    '/reconciliation/run',
    requireScope('manage'),
    async (_req: Request, res: Response) => {
      await deps.triggerRun();
      res.status(202).json({ enqueued: true });
    },
  );

  return router;
}

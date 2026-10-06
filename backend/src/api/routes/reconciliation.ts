import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { ownerFilter } from '../ownership.js';

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
  errorMessage?: string | null;
  createdAt: Date;
}

export interface ReconciliationRouteDeps {
  getLatestRun: () => Promise<ReconciliationRunRecord | null>;
  /** The subset of a run's object ids that belong to `owner`'s assets. */
  filterReconciliationIdsOwnedBy: (ids: string[], owner: string) => Promise<string[]>;
  /** Enqueue an on-demand pass; `enqueued` is false when one was already pending. */
  triggerRun: () => Promise<{ enqueued: boolean }>;
}

// the deployment-wide figures: health, like the host counts on system status
function formatAggregates(r: ReconciliationRunRecord) {
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
    error_message: r.errorMessage ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Reconciliation reporting. Surfaces the latest background run comparing
 * PostgreSQL's tracked objects against the indexer's inventory, and lets an
 * operator trigger a run on demand. Read/trigger both require `manage`.
 *
 * A run covers every tenant, so the object ids in it are scoped: a tenant
 * gets only the missing ids of its own assets, and orphaned ids, which belong
 * to no asset and so to no tenant, only reach the platform identity.
 */
export function createReconciliationRoutes(deps: ReconciliationRouteDeps): Router {
  const router = Router();

  /** GET /api/v1/reconciliation: latest completed run. */
  router.get('/reconciliation', requireScope('manage'), async (req: Request, res: Response) => {
    const run = await deps.getLatestRun();
    if (!run) {
      throw new AppError(404, 'No reconciliation run has completed yet');
    }
    const owner = ownerFilter(req.apiKey!.creatorAddress);
    if (owner === undefined) {
      res.json({
        ...formatAggregates(run),
        scope: 'deployment',
        missing_ids: run.missingIds,
        orphaned_ids: run.orphanedIds,
      });
      return;
    }
    const missingIds = await deps.filterReconciliationIdsOwnedBy(run.missingIds, owner);
    res.json({
      ...formatAggregates(run),
      scope: 'account',
      account_missing_count: missingIds.length,
      missing_ids: missingIds,
    });
  });

  /** POST /api/v1/reconciliation/run: enqueue an on-demand run. */
  router.post(
    '/reconciliation/run',
    requireScope('manage'),
    async (_req: Request, res: Response) => {
      const { enqueued } = await deps.triggerRun();
      res.status(202).json({ enqueued, already_pending: !enqueued });
    },
  );

  return router;
}

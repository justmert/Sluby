import { Router, type Request, type Response } from 'express';
import { requireOperations, requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { seesOperations } from '../ownership.js';

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
  /**
   * The live video holding each id, among `owner`'s videos (every account's
   * for undefined); ids no such video holds are left out.
   */
  findVideosForObjectIds: (
    ids: string[],
    owner: string | undefined,
  ) => Promise<Array<{ objectId: string; videoAssetId: string; title: string }>>;
  /** Enqueue an on-demand pass; `enqueued` is false when one was already pending. */
  triggerRun: () => Promise<{ enqueued: boolean }>;
}

// the deployment-wide figures, for the platform identity and operators
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
 * PostgreSQL's tracked objects against the indexer's inventory, and lets the
 * platform identity or an operator trigger a run on demand. Both require
 * `manage`.
 *
 * A run covers every tenant. The platform identity and operators get all of
 * it; a tenant gets only the drift of its own assets (the missing objects
 * among them), since the deployment-wide counts, orphans and failure text
 * describe other tenants and the deployment's setup.
 */
/**
 * Each missing id with the video it belongs to, in the order of `ids`, so
 * a report can link to the video. Null fields when no live video in scope
 * holds the object (its video was deleted since, say).
 */
async function missingObjects(
  deps: ReconciliationRouteDeps,
  ids: string[],
  owner: string | undefined,
) {
  const videos = new Map(
    (await deps.findVideosForObjectIds(ids, owner)).map((v) => [v.objectId, v]),
  );
  return ids.map((id) => {
    const v = videos.get(id);
    return {
      object_id: id,
      video_asset_id: v?.videoAssetId ?? null,
      title: v?.title ?? null,
    };
  });
}

export function createReconciliationRoutes(deps: ReconciliationRouteDeps): Router {
  const router = Router();

  /** GET /api/v1/reconciliation: latest completed run. */
  router.get('/reconciliation', requireScope('manage'), async (req: Request, res: Response) => {
    const run = await deps.getLatestRun();
    if (!run) {
      throw new AppError(404, 'No reconciliation run has completed yet');
    }
    if (seesOperations(req.apiKey)) {
      res.json({
        ...formatAggregates(run),
        scope: 'deployment',
        missing_ids: run.missingIds,
        missing_objects: await missingObjects(deps, run.missingIds, undefined),
        orphaned_ids: run.orphanedIds,
      });
      return;
    }
    const missingIds = await deps.filterReconciliationIdsOwnedBy(
      run.missingIds,
      req.apiKey!.creatorAddress,
    );
    res.json({
      id: run.id,
      started_at: run.startedAt.toISOString(),
      finished_at: run.finishedAt.toISOString(),
      created_at: run.createdAt.toISOString(),
      scope: 'account',
      // a failed run checked nothing; otherwise drift means this account's drift
      status: run.status === 'failed' ? 'failed' : missingIds.length > 0 ? 'drift' : 'ok',
      missing_count: missingIds.length,
      missing_ids: missingIds,
      missing_objects: await missingObjects(deps, missingIds, req.apiKey!.creatorAddress),
    });
  });

  /** POST /api/v1/reconciliation/run: enqueue an on-demand, deployment-wide run. */
  router.post(
    '/reconciliation/run',
    requireScope('manage'),
    requireOperations(),
    async (_req: Request, res: Response) => {
      const { enqueued } = await deps.triggerRun();
      res.status(202).json({ enqueued, already_pending: !enqueued });
    },
  );

  return router;
}

import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import type { AssetStats } from '../../db/queries/stats.js';
import type { SystemStatus } from '../../system/status.js';

export interface StatsRouteDeps {
  /** `owner` scopes the totals to one tenant (undefined = platform key). */
  getAssetStats: (owner?: string) => Promise<AssetStats>;
  getSystemStatus: () => Promise<SystemStatus>;
}

function formatAssetStats(stats: AssetStats) {
  return {
    total: stats.total,
    by_status: stats.byStatus,
    stored_bytes: stats.storedBytes,
    ready_duration_ms: stats.readyDurationMs,
    object_count: stats.objectCount,
  };
}

function formatSystemStatus(s: SystemStatus) {
  const probe = (p: { ok: boolean; latencyMs: number; error?: string }) => ({
    ok: p.ok,
    latency_ms: p.latencyMs,
    ...(p.error ? { error: p.error } : {}),
  });
  const account = s.indexer.account;
  return {
    status: s.status,
    checked_at: s.checkedAt,
    version: s.version,
    uptime_seconds: s.uptimeSeconds,
    database: probe(s.database),
    redis: probe(s.redis),
    indexer: {
      ...probe(s.indexer),
      url: s.indexer.url,
      network: s.indexer.network,
      account: account
        ? {
            account_key: account.accountKey,
            ready: account.ready,
            app_name: account.appName,
            pinned_data: account.pinnedData,
            pinned_size: account.pinnedSize,
            max_pinned_data: account.maxPinnedData,
            remaining_storage: account.remainingStorage,
            last_used: account.lastUsed,
          }
        : null,
      hosts: s.indexer.hosts
        ? {
            total: s.indexer.hosts.total,
            good_for_upload: s.indexer.hosts.goodForUpload,
            countries: s.indexer.hosts.countries,
          }
        : null,
    },
    reconciliation: s.reconciliation
      ? {
          status: s.reconciliation.status,
          finished_at: s.reconciliation.finishedAt,
          in_sync_count: s.reconciliation.inSyncCount,
          orphan_count: s.reconciliation.orphanCount,
          missing_count: s.reconciliation.missingCount,
        }
      : null,
    cache: {
      hits: s.cache.hits,
      misses: s.cache.misses,
      object_bytes: s.cache.objectBytes,
      object_max_bytes: s.cache.objectMaxBytes,
      object_items: s.cache.objectItems,
      manifest_items: s.cache.manifestItems,
    },
  };
}

export function createStatsRoutes(deps: StatsRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/stats
   * Library totals for the caller's tenant: asset counts by status, bytes
   * stored on Sia, ready playtime, and the number of Sia objects.
   */
  router.get('/stats', requireScope('read'), async (req: Request, res: Response) => {
    const stats = await deps.getAssetStats(ownerFilter(req.apiKey!.creatorAddress));
    res.json(formatAssetStats(stats));
  });

  /**
   * GET /api/v1/system/status
   * Live platform status: database, redis, the Sia indexer (account usage and
   * host pool), the last reconciliation run, and the delivery cache.
   */
  router.get('/system/status', requireScope('read'), async (_req: Request, res: Response) => {
    const status = await deps.getSystemStatus();
    // a polled health view must never be served stale by an intermediary
    res.setHeader('Cache-Control', 'no-store');
    res.json(formatSystemStatus(status));
  });

  return router;
}

import type { IndexerAccount, IndexerHost } from '../storage/sia-client.js';

/** Result of one health probe. */
export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReconciliationSnapshot {
  status: 'ok' | 'drift' | 'failed';
  finishedAt: string;
  inSyncCount: number;
  orphanCount: number;
  missingCount: number;
}

export interface CacheSnapshot {
  hits: number;
  misses: number;
  objectBytes: number;
  objectMaxBytes: number;
  objectItems: number;
  manifestItems: number;
}

export interface SystemStatus {
  /** ok: everything answers; degraded: the indexer is unhappy; down: db or redis fail. */
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  version: string;
  uptimeSeconds: number;
  database: ProbeResult;
  redis: ProbeResult;
  indexer: ProbeResult & {
    url: string;
    network: string;
    account: IndexerAccount | null;
    hosts: { total: number; goodForUpload: number; countries: number } | null;
  };
  reconciliation: ReconciliationSnapshot | null;
  cache: CacheSnapshot;
}

export interface SystemStatusDeps {
  version: string;
  startedAt: Date;
  indexerUrl: string;
  network: string;
  pingDatabase: () => Promise<void>;
  pingRedis: () => Promise<void>;
  getAccount: () => Promise<IndexerAccount>;
  listHosts: () => Promise<IndexerHost[]>;
  getLatestReconciliation: () => Promise<ReconciliationSnapshot | null>;
  getCacheStats: () => CacheSnapshot;
  /** Per-probe timeout, so one hung dependency cannot stall the dashboard. */
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe<T>(
  run: () => Promise<T>,
  what: string,
  timeoutMs: number,
  now: () => number,
): Promise<{ result: ProbeResult; value: T | null }> {
  const start = now();
  try {
    const value = await withTimeout(run(), timeoutMs, what);
    return { result: { ok: true, latencyMs: now() - start }, value };
  } catch (err) {
    return {
      result: {
        ok: false,
        latencyMs: now() - start,
        error: err instanceof Error ? err.message : String(err),
      },
      value: null,
    };
  }
}

/** Run every probe in parallel and fold them into one status report. */
export async function collectSystemStatus(deps: SystemStatusDeps): Promise<SystemStatus> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? Date.now;

  const [database, redis, account, hosts, reconciliation] = await Promise.all([
    probe(deps.pingDatabase, 'database ping', timeoutMs, now),
    probe(deps.pingRedis, 'redis ping', timeoutMs, now),
    probe(deps.getAccount, 'indexer account', timeoutMs, now),
    probe(deps.listHosts, 'indexer hosts', timeoutMs, now),
    probe(deps.getLatestReconciliation, 'reconciliation lookup', timeoutMs, now),
  ]);

  const hostList = hosts.value;
  const indexerOk = account.result.ok && hosts.result.ok && (account.value?.ready ?? false);
  const indexerError =
    account.result.error ??
    hosts.result.error ??
    (account.value && !account.value.ready ? 'indexer account is not ready yet' : undefined);

  const status: SystemStatus['status'] =
    !database.result.ok || !redis.result.ok ? 'down' : indexerOk ? 'ok' : 'degraded';

  return {
    status,
    checkedAt: new Date(now()).toISOString(),
    version: deps.version,
    uptimeSeconds: Math.max(0, Math.round((now() - deps.startedAt.getTime()) / 1000)),
    database: database.result,
    redis: redis.result,
    indexer: {
      ok: indexerOk,
      latencyMs: account.result.latencyMs,
      ...(indexerError ? { error: indexerError } : {}),
      url: deps.indexerUrl,
      network: deps.network,
      account: account.value,
      hosts: hostList
        ? {
            total: hostList.length,
            goodForUpload: hostList.filter((h) => h.goodForUpload).length,
            countries: new Set(hostList.map((h) => h.countryCode).filter(Boolean)).size,
          }
        : null,
    },
    reconciliation: reconciliation.value,
    cache: deps.getCacheStats(),
  };
}

/**
 * Memoize the report for `ttlMs` and share one in-flight collection between
 * concurrent callers, so a dashboard polling every few seconds does not turn
 * into a stream of indexer calls.
 */
export function createCachedSystemStatus(deps: SystemStatusDeps, ttlMs = 15_000) {
  const now = deps.now ?? Date.now;
  let cached: { value: SystemStatus; at: number } | null = null;
  let inFlight: Promise<SystemStatus> | null = null;

  return async (): Promise<SystemStatus> => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    if (!inFlight) {
      inFlight = collectSystemStatus(deps)
        .then((value) => {
          cached = { value, at: now() };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}

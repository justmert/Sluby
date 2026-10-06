/**
 * Reconciliation orchestrator.
 *
 * Gathers the two inventories (what PostgreSQL tracks vs. what the indexer
 * pins), diffs them, and persists a run record. It is deliberately
 * report-only: it flags orphans and missing objects but never deletes
 * anything, matching the proposal ("flagging orphaned objects for
 * cleanup"). Cleanup is a human/operator decision.
 *
 * All I/O is injected so the orchestration is unit-testable without a DB
 * or a live indexer.
 */

import { diffInventory, type IndexerObjectState } from './inventory-diff.js';

/**
 * How recent an indexer change must be to count as work in progress rather
 * than drift. An upload pins its objects during the Sia upload stage, minutes
 * before finalize records them, and a deletion unpins objects moments before
 * it forgets them.
 */
export const RECONCILE_GRACE_MS = 60 * 60 * 1000;

/** Runs kept in reconciliation_runs; each run deletes the ones before these. */
export const RECONCILE_RUNS_KEPT = 100;

export interface ReconciliationSummary {
  startedAt: Date;
  finishedAt: Date;
  dbObjectCount: number;
  indexerObjectCount: number;
  inSyncCount: number;
  orphanCount: number;
  missingCount: number;
  /** Ids pinned by the indexer but no longer tracked in the DB. */
  orphanedIds: string[];
  /** Ids tracked in the DB but absent from the indexer. */
  missingIds: string[];
  /** Ids left out of the drift lists because the indexer changed them within the grace window. */
  inFlightCount: number;
  status: 'ok' | 'drift' | 'failed';
  /** Set when status is 'failed': why the run could not complete. */
  errorMessage?: string;
}

export interface ReconcileDeps {
  /** All Sia object ids the DB believes it has stored. */
  getDbObjectIds: () => Promise<Iterable<string>>;
  /**
   * Bring the saved copy of the indexer's inventory up to date. Changes after
   * `settledBefore` are still in flight and are read again next run.
   */
  syncIndexer: (settledBefore: Date) => Promise<void>;
  /** The saved copy: the latest state the indexer reported per object id. */
  getIndexerInventory: () => Promise<ReadonlyMap<string, IndexerObjectState>>;
  /** Persist the completed run (e.g. into `reconciliation_runs`). */
  recordRun: (summary: ReconciliationSummary) => Promise<void>;
  /** Clock, injected for deterministic tests. */
  now: () => Date;
  /** Defaults to RECONCILE_GRACE_MS. */
  graceMs?: number;
}

export async function runReconciliation(deps: ReconcileDeps): Promise<ReconciliationSummary> {
  const startedAt = deps.now();

  try {
    return await reconcileOnce(deps, startedAt);
  } catch (err) {
    // Persist the failure. Without this, an ongoing indexer or database
    // outage leaves no row at all in reconciliation_runs, so the drift
    // report looks merely stale rather than broken.
    const failure: ReconciliationSummary = {
      startedAt,
      finishedAt: deps.now(),
      dbObjectCount: 0,
      indexerObjectCount: 0,
      inSyncCount: 0,
      orphanCount: 0,
      missingCount: 0,
      orphanedIds: [],
      missingIds: [],
      inFlightCount: 0,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
    try {
      await deps.recordRun(failure);
    } catch {
      // Bookkeeping must never mask the original cause.
    }
    throw err;
  }
}

async function reconcileOnce(deps: ReconcileDeps, startedAt: Date): Promise<ReconciliationSummary> {
  const settledBefore = new Date(startedAt.getTime() - (deps.graceMs ?? RECONCILE_GRACE_MS));

  // the database first: whatever is recorded or forgotten while the indexer
  // is read then shows up as a recent indexer change, not as drift
  const dbIds = new Set(await deps.getDbObjectIds());
  await deps.syncIndexer(settledBefore);
  const indexer = await deps.getIndexerInventory();
  const diff = diffInventory(dbIds, indexer, settledBefore);

  let pinned = 0;
  for (const state of indexer.values()) if (!state.deleted) pinned++;

  const finishedAt = deps.now();
  const summary: ReconciliationSummary = {
    startedAt,
    finishedAt,
    dbObjectCount: dbIds.size,
    indexerObjectCount: pinned,
    inSyncCount: diff.inSync.length,
    orphanCount: diff.orphanedInIndexer.length,
    missingCount: diff.missingFromIndexer.length,
    orphanedIds: diff.orphanedInIndexer,
    missingIds: diff.missingFromIndexer,
    inFlightCount: diff.inFlight.length,
    status:
      diff.orphanedInIndexer.length === 0 && diff.missingFromIndexer.length === 0 ? 'ok' : 'drift',
  };

  await deps.recordRun(summary);
  return summary;
}

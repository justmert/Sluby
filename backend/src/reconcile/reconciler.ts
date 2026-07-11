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

import { diffInventory } from './inventory-diff.js';

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
  status: 'ok' | 'drift';
}

export interface ReconcileDeps {
  /** All Sia object ids the DB believes it has stored. */
  getDbObjectIds: () => Promise<Iterable<string>>;
  /** The indexer's current inventory of pinned object ids. */
  getIndexerObjectIds: () => Promise<Iterable<string>>;
  /** Persist the completed run (e.g. into `reconciliation_runs`). */
  recordRun: (summary: ReconciliationSummary) => Promise<void>;
  /** Clock, injected for deterministic tests. */
  now: () => Date;
}

export async function runReconciliation(
  deps: ReconcileDeps,
): Promise<ReconciliationSummary> {
  const startedAt = deps.now();

  const [dbIds, indexerIds] = await Promise.all([
    deps.getDbObjectIds(),
    deps.getIndexerObjectIds(),
  ]);

  const dbSet = new Set(dbIds);
  const indexerSet = new Set(indexerIds);
  const diff = diffInventory(dbSet, indexerSet);

  const finishedAt = deps.now();
  const summary: ReconciliationSummary = {
    startedAt,
    finishedAt,
    dbObjectCount: dbSet.size,
    indexerObjectCount: indexerSet.size,
    inSyncCount: diff.inSync.length,
    orphanCount: diff.orphanedInIndexer.length,
    missingCount: diff.missingFromIndexer.length,
    orphanedIds: diff.orphanedInIndexer,
    missingIds: diff.missingFromIndexer,
    status:
      diff.orphanedInIndexer.length === 0 && diff.missingFromIndexer.length === 0
        ? 'ok'
        : 'drift',
  };

  await deps.recordRun(summary);
  return summary;
}

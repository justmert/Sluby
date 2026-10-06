import { describe, it, expect, vi } from 'vitest';
import {
  RECONCILE_GRACE_MS,
  runReconciliation,
  type ReconcileDeps,
} from '../reconcile/reconciler.js';
import {
  syncObjectFeed,
  type FeedStore,
  type ObjectEventLite,
  type ObjectsCursor,
} from '../reconcile/collect-inventory.js';
import type { IndexerObjectState } from '../reconcile/inventory-diff.js';

const START = new Date('2026-05-01T12:00:00Z');
const LONG_AGO = new Date('2026-04-01T00:00:00Z');

const inventory = (ids: string[], eventAt = LONG_AGO) =>
  new Map<string, IndexerObjectState>(ids.map((id) => [id, { deleted: false, eventAt }]));

function makeDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  let tick = 0;
  return {
    getDbObjectIds: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    syncIndexer: vi.fn().mockResolvedValue(undefined),
    getIndexerInventory: vi.fn().mockResolvedValue(inventory(['b', 'c', 'd'])),
    recordRun: vi.fn().mockResolvedValue(undefined),
    // deterministic clock: first call = start, second = finish
    now: vi.fn(() => new Date(START.getTime() + 1000 * tick++)),
    ...overrides,
  };
}

describe('runReconciliation', () => {
  it('diffs DB vs indexer inventory and returns a drift summary', async () => {
    const summary = await runReconciliation(makeDeps());

    expect(summary.dbObjectCount).toBe(3);
    expect(summary.indexerObjectCount).toBe(3);
    expect(summary.inSyncCount).toBe(2); // b, c
    expect(summary.orphanedIds).toEqual(['d']);
    expect(summary.missingIds).toEqual(['a']);
    expect(summary.orphanCount).toBe(1);
    expect(summary.missingCount).toBe(1);
    expect(summary.inFlightCount).toBe(0);
    expect(summary.status).toBe('drift');
    expect(summary.startedAt.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(summary.finishedAt.toISOString()).toBe('2026-05-01T12:00:01.000Z');
  });

  it('reports status "ok" when inventories match exactly', async () => {
    const summary = await runReconciliation(
      makeDeps({
        getDbObjectIds: vi.fn().mockResolvedValue(['x', 'y']),
        getIndexerInventory: vi.fn().mockResolvedValue(inventory(['x', 'y'])),
      }),
    );

    expect(summary.status).toBe('ok');
    expect(summary.orphanCount).toBe(0);
    expect(summary.missingCount).toBe(0);
    expect(summary.inSyncCount).toBe(2);
  });

  it('counts only pinned objects on the indexer side', async () => {
    const indexer = inventory(['x']);
    indexer.set('deleted-long-ago', { deleted: true, eventAt: LONG_AGO });
    const summary = await runReconciliation(
      makeDeps({
        getDbObjectIds: vi.fn().mockResolvedValue(['x']),
        getIndexerInventory: vi.fn().mockResolvedValue(indexer),
      }),
    );
    expect(summary.indexerObjectCount).toBe(1);
    expect(summary.status).toBe('ok');
  });

  it('persists the run via recordRun with the computed summary', async () => {
    const deps = makeDeps();
    const summary = await runReconciliation(deps);
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.recordRun).toHaveBeenCalledWith(summary);
  });

  it('reads the database before it syncs the indexer, with the grace window as the settled line', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      getDbObjectIds: vi.fn(async () => {
        order.push('db');
        return ['a'];
      }),
      syncIndexer: vi.fn(async () => {
        order.push('sync');
      }),
      getIndexerInventory: vi.fn(async () => {
        order.push('inventory');
        return inventory(['a']);
      }),
    });

    await runReconciliation(deps);

    expect(order).toEqual(['db', 'sync', 'inventory']);
    expect(deps.syncIndexer).toHaveBeenCalledWith(new Date(START.getTime() - RECONCILE_GRACE_MS));
  });

  it('leaves work in progress out of the drift lists', async () => {
    const minuteAgo = new Date(START.getTime() - 60_000);
    const indexer = inventory(['kept']);
    indexer.set('uploading', { deleted: false, eventAt: minuteAgo });
    indexer.set('deleting', { deleted: true, eventAt: minuteAgo });

    const summary = await runReconciliation(
      makeDeps({
        getDbObjectIds: vi.fn().mockResolvedValue(['kept', 'deleting']),
        getIndexerInventory: vi.fn().mockResolvedValue(indexer),
      }),
    );

    expect(summary.status).toBe('ok');
    expect(summary.orphanedIds).toEqual([]);
    expect(summary.missingIds).toEqual([]);
    expect(summary.inFlightCount).toBe(2);
  });

  it('records a failed run when the indexer is unreachable, then rethrows', async () => {
    const deps = makeDeps({
      syncIndexer: vi.fn().mockRejectedValue(new Error('indexd unreachable')),
    });

    await expect(runReconciliation(deps)).rejects.toThrow('indexd unreachable');

    // The failure must be persisted, otherwise an ongoing outage is invisible
    // in reconciliation_runs and only shows up in ephemeral logs.
    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    const recorded = vi.mocked(deps.recordRun).mock.calls[0][0];
    expect(recorded.status).toBe('failed');
    expect(recorded.errorMessage).toBe('indexd unreachable');
  });

  it('still rethrows if persisting the failed run also fails', async () => {
    const deps = makeDeps({
      syncIndexer: vi.fn().mockRejectedValue(new Error('indexer down')),
      recordRun: vi.fn().mockRejectedValue(new Error('db down')),
    });

    // The original cause must survive, not be masked by the bookkeeping error.
    await expect(runReconciliation(deps)).rejects.toThrow('indexer down');
  });

  it('records a failed run, not drift, against an indexer whose cursor stalls', async () => {
    // 600 tracked objects; the indexer returns the same first 500 forever
    const all: ObjectEventLite[] = Array.from({ length: 600 }, (_, i) => ({
      id: `obj-${String(i).padStart(3, '0')}`,
      deleted: false,
      updatedAt: LONG_AGO,
    }));
    const fetchPage = vi.fn(async () => all.slice(0, 500));
    const objects = new Map<string, IndexerObjectState>();
    let saved: ObjectsCursor | null = null;
    const store: FeedStore = {
      begin: async () => saved,
      applyPage: async (_feed, events, cursor) => {
        for (const e of events) objects.set(e.id, { deleted: e.deleted, eventAt: e.updatedAt });
        saved = cursor;
      },
      pruneDeleted: async () => {},
    };
    const deps = makeDeps({
      getDbObjectIds: vi.fn().mockResolvedValue(all.map((o) => o.id)),
      syncIndexer: (settledBefore) =>
        syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore }).then(() => {}),
      getIndexerInventory: async () => objects,
    });

    await expect(runReconciliation(deps)).rejects.toThrow(/did not advance/);

    const recorded = vi.mocked(deps.recordRun).mock.calls[0][0];
    expect(recorded.status).toBe('failed');
    expect(recorded.missingIds).toEqual([]);
    expect(recorded.errorMessage).toMatch(/did not advance/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

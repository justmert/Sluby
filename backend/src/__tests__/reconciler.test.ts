import { describe, it, expect, vi } from 'vitest';
import { runReconciliation, type ReconcileDeps } from '../reconcile/reconciler.js';

function makeDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  let tick = 0;
  return {
    getDbObjectIds: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    getIndexerObjectIds: vi.fn().mockResolvedValue(new Set(['b', 'c', 'd'])),
    recordRun: vi.fn().mockResolvedValue(undefined),
    // deterministic clock: first call = start, second = finish
    now: vi.fn(() => new Date(`2026-05-01T00:00:0${tick++}Z`)),
    ...overrides,
  };
}

describe('runReconciliation', () => {
  it('diffs DB vs indexer inventory and returns a drift summary', async () => {
    const deps = makeDeps();

    const summary = await runReconciliation(deps);

    expect(summary.dbObjectCount).toBe(3);
    expect(summary.indexerObjectCount).toBe(3);
    expect(summary.inSyncCount).toBe(2); // b, c
    expect(summary.orphanedIds).toEqual(['d']);
    expect(summary.missingIds).toEqual(['a']);
    expect(summary.orphanCount).toBe(1);
    expect(summary.missingCount).toBe(1);
    expect(summary.status).toBe('drift');
    expect(summary.startedAt.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(summary.finishedAt.toISOString()).toBe('2026-05-01T00:00:01.000Z');
  });

  it('reports status "ok" when inventories match exactly', async () => {
    const deps = makeDeps({
      getDbObjectIds: vi.fn().mockResolvedValue(['x', 'y']),
      getIndexerObjectIds: vi.fn().mockResolvedValue(new Set(['x', 'y'])),
    });

    const summary = await runReconciliation(deps);

    expect(summary.status).toBe('ok');
    expect(summary.orphanCount).toBe(0);
    expect(summary.missingCount).toBe(0);
    expect(summary.inSyncCount).toBe(2);
  });

  it('persists the run via recordRun with the computed summary', async () => {
    const deps = makeDeps();

    const summary = await runReconciliation(deps);

    expect(deps.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.recordRun).toHaveBeenCalledWith(summary);
  });

  it('records a failed run when the indexer is unreachable, then rethrows', async () => {
    const boom = new Error('indexd unreachable');
    const deps = makeDeps({
      getIndexerObjectIds: vi.fn().mockRejectedValue(boom),
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
      getIndexerObjectIds: vi.fn().mockRejectedValue(new Error('indexer down')),
      recordRun: vi.fn().mockRejectedValue(new Error('db down')),
    });

    // The original cause must survive, not be masked by the bookkeeping error.
    await expect(runReconciliation(deps)).rejects.toThrow('indexer down');
  });

  it('accepts an array from getIndexerObjectIds as well as a Set', async () => {
    const deps = makeDeps({
      getIndexerObjectIds: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    const summary = await runReconciliation(deps);

    expect(summary.status).toBe('ok');
    expect(summary.inSyncCount).toBe(3);
  });
});

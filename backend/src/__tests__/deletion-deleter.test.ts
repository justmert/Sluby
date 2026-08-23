import { describe, it, expect, vi } from 'vitest';
import { runAssetDeletion, type DeletionDeps } from '../deletion/deleter.js';

function makeDeps(overrides: Partial<DeletionDeps> = {}) {
  const calls: string[] = [];
  const deps: DeletionDeps = {
    deleteObject: vi.fn(async (id: string) => {
      calls.push(`delete:${id}`);
    }),
    pruneSlabs: vi.fn(async () => {
      calls.push('prune');
    }),
    markUnpinned: vi.fn(async (_assetId: string, ids: string[]) => {
      calls.push(`mark:${ids.join('+')}`);
    }),
    evictCache: vi.fn((ids: string[]) => {
      calls.push(`evict:${ids.join('+')}`);
    }),
    removeAsset: vi.fn(async (id: string) => {
      calls.push(`remove:${id}`);
    }),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return { deps, calls };
}

describe('runAssetDeletion', () => {
  it('unpins all, evicts + marks them, prunes, then removes the row', async () => {
    const { deps, calls } = makeDeps();

    const result = await runAssetDeletion(deps, {
      videoAssetId: 'v1',
      objectIds: ['o1', 'o2', 'o3'],
    });

    expect(deps.deleteObject).toHaveBeenCalledTimes(3);
    expect(deps.evictCache).toHaveBeenCalledWith(['o1', 'o2', 'o3']);
    expect(deps.markUnpinned).toHaveBeenCalledWith('v1', ['o1', 'o2', 'o3']);
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
    expect(calls).toEqual([
      'delete:o1',
      'delete:o2',
      'delete:o3',
      'evict:o1+o2+o3',
      'mark:o1+o2+o3',
      'prune',
      'remove:v1',
    ]);
    expect(result).toEqual({ videoAssetId: 'v1', unpinned: 3, failed: [] });
  });

  it('throws on partial failure and does NOT remove the row (so retry/GC re-drive)', async () => {
    const deleteObject = vi.fn(async (id: string) => {
      if (id === 'o2') throw new Error('host down');
    });
    const { deps } = makeDeps({ deleteObject });

    await expect(
      runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: ['o1', 'o2', 'o3'] }),
    ).rejects.toThrow(/failed to unpin/);

    // Only the successful objects are evicted + marked (so the retry re-collects
    // just o2), the row is kept, and prune still ran.
    expect(deps.evictCache).toHaveBeenCalledWith(['o1', 'o3']);
    expect(deps.markUnpinned).toHaveBeenCalledWith('v1', ['o1', 'o3']);
    expect(deps.pruneSlabs).toHaveBeenCalledTimes(1);
    expect(deps.removeAsset).not.toHaveBeenCalled();
  });

  it('removes the row when there is nothing to unpin', async () => {
    const { deps } = makeDeps();
    const result = await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: [] });
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(deps.markUnpinned).not.toHaveBeenCalled();
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
    expect(result).toEqual({ videoAssetId: 'v1', unpinned: 0, failed: [] });
  });

  it('does not let a prune failure block row removal', async () => {
    const pruneSlabs = vi.fn(async () => {
      throw new Error('prune boom');
    });
    const { deps } = makeDeps({ pruneSlabs });
    await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: ['o1'] });
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
  });
});

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
    removeAsset: vi.fn(async (id: string) => {
      calls.push(`remove:${id}`);
    }),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return { deps, calls };
}

describe('runAssetDeletion', () => {
  it('unpins every object, then prunes, then removes the row — in that order', async () => {
    const { deps, calls } = makeDeps();

    const result = await runAssetDeletion(deps, {
      videoAssetId: 'v1',
      objectIds: ['o1', 'o2', 'o3'],
    });

    expect(deps.deleteObject).toHaveBeenCalledTimes(3);
    expect(deps.deleteObject).toHaveBeenCalledWith('o1');
    expect(deps.deleteObject).toHaveBeenCalledWith('o2');
    expect(deps.deleteObject).toHaveBeenCalledWith('o3');
    expect(calls).toEqual(['delete:o1', 'delete:o2', 'delete:o3', 'prune', 'remove:v1']);
    expect(result).toEqual({ videoAssetId: 'v1', unpinned: 3, failed: [] });
  });

  it('continues past a failed unpin, still prunes and removes, and reports the straggler', async () => {
    const deleteObject = vi.fn(async (id: string) => {
      if (id === 'o2') throw new Error('host down');
    });
    const { deps } = makeDeps({ deleteObject });

    const result = await runAssetDeletion(deps, {
      videoAssetId: 'v1',
      objectIds: ['o1', 'o2', 'o3'],
    });

    expect(deps.deleteObject).toHaveBeenCalledTimes(3);
    expect(deps.pruneSlabs).toHaveBeenCalledTimes(1);
    // The row is still removed so the asset truly disappears.
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
    expect(result.unpinned).toBe(2);
    expect(result.failed).toEqual(['o2']);
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('still removes the row when there are no objects to unpin', async () => {
    const { deps } = makeDeps();
    const result = await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: [] });
    expect(deps.deleteObject).not.toHaveBeenCalled();
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

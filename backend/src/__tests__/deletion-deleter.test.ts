import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAssetDeletion, type DeletionDeps } from '../deletion/deleter.js';
import { removeAssetSources } from '../upload/source-files.js';

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
    removeSources: vi.fn(async (id: string) => {
      calls.push(`sources:${id}`);
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
      'sources:v1',
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

describe('runAssetDeletion with the source upload files on disk', () => {
  let dir: string;
  const log = { info: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sluby-delete-sources-'));
    vi.clearAllMocks();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // a tus upload as the file store leaves it: the data plus its json sidecar
  function upload(id: string): string {
    const filePath = path.join(dir, id);
    writeFileSync(filePath, 'video bytes');
    writeFileSync(`${filePath}.json`, JSON.stringify({ id, size: 11, offset: 0 }));
    return filePath;
  }

  function depsFor(paths: Record<string, string[]>) {
    return makeDeps({
      removeSources: (id) =>
        removeAssetSources(id, { listSourcePaths: async (a) => paths[a] ?? [], log }),
    });
  }

  it('deletes the source of a failed asset and the partial file of an upload in flight', async () => {
    const failedSource = upload('failed-src');
    const partial = upload('partial-src');
    const otherAsset = upload('other-src');
    const { deps } = depsFor({ v1: [failedSource, partial], v2: [otherAsset] });

    await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: ['o1'] });

    for (const p of [failedSource, partial]) {
      expect(existsSync(p)).toBe(false);
      expect(existsSync(`${p}.json`)).toBe(false);
    }
    expect(existsSync(otherAsset)).toBe(true);
    expect(existsSync(`${otherAsset}.json`)).toBe(true);
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
  });

  it('still deletes the asset when the source is already gone', async () => {
    const { deps } = depsFor({ v1: [path.join(dir, 'never-written')] });

    await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: [] });

    expect(log.error).not.toHaveBeenCalled();
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
  });

  it('logs a file it can not remove, with its path, and still deletes the asset', async () => {
    // a non-empty directory where the upload should be makes rm fail for real
    const stuck = path.join(dir, 'stuck');
    mkdirSync(stuck);
    writeFileSync(path.join(stuck, 'inner'), 'x');
    const { deps } = depsFor({ v1: [stuck] });

    await runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: ['o1'] });

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ videoAssetId: 'v1', path: stuck, err: expect.any(Error) }),
      'Failed to remove source upload file',
    );
    expect(deps.removeAsset).toHaveBeenCalledWith('v1');
  });

  it('keeps the row when the sessions can not be read, so the retry still finds the files', async () => {
    const source = upload('kept-src');
    const { deps } = makeDeps({
      removeSources: (id) =>
        removeAssetSources(id, {
          listSourcePaths: async () => {
            throw new Error('db down');
          },
          log,
        }),
    });

    await expect(runAssetDeletion(deps, { videoAssetId: 'v1', objectIds: ['o1'] })).rejects.toThrow(
      'db down',
    );

    expect(existsSync(source)).toBe(true);
    expect(deps.removeAsset).not.toHaveBeenCalled();
  });
});

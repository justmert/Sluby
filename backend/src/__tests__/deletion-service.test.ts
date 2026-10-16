import { describe, it, expect, vi } from 'vitest';
import {
  buildDeleteAsset,
  buildDeletionGc,
  REDRIVE_ALERT_AFTER,
  type DeletionGcDeps,
} from '../deletion/service.js';

describe('buildDeleteAsset', () => {
  it('soft-deletes then enqueues the async unpin job', async () => {
    const softDelete = vi.fn().mockResolvedValue({ id: 'v1' });
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const deleteAsset = buildDeleteAsset({ softDelete, enqueue });
    const ok = await deleteAsset('v1', '0xowner');

    expect(ok).toBe(true);
    expect(softDelete).toHaveBeenCalledWith('v1', '0xowner');
    expect(enqueue).toHaveBeenCalledWith('v1');
  });

  it('returns false and enqueues nothing when the soft-delete matches no row', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn();

    const deleteAsset = buildDeleteAsset({ softDelete, enqueue });
    const ok = await deleteAsset('missing', '0xowner');

    expect(ok).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('buildDeletionGc', () => {
  function gcDeps(overrides: Partial<DeletionGcDeps> = {}) {
    const deps: DeletionGcDeps = {
      listPending: vi.fn().mockResolvedValue([]),
      deletionInFlight: vi.fn().mockResolvedValue(false),
      redrive: vi.fn().mockResolvedValue(1),
      releaseObjects: vi.fn().mockResolvedValue({ released: 0, unpinned: 0, failed: 0 }),
      sweepOutput: vi.fn().mockResolvedValue(0),
      logger: { info: vi.fn(), error: vi.fn() },
      ...overrides,
    };
    return deps;
  }

  it('re-drives every stuck asset', async () => {
    const deps = gcDeps({ listPending: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) });
    const result = await buildDeletionGc(deps)();
    expect(result).toMatchObject({ redriven: 2, inFlight: 0 });
    expect(deps.redrive).toHaveBeenCalledWith('a');
    expect(deps.redrive).toHaveBeenCalledWith('b');
  });

  it('leaves an asset alone while a delete job for it is queued or running', async () => {
    const deps = gcDeps({
      listPending: vi.fn().mockResolvedValue([{ id: 'busy' }, { id: 'stuck' }]),
      deletionInFlight: vi.fn(async (id: string) => id === 'busy'),
    });
    const result = await buildDeletionGc(deps)();
    expect(result).toMatchObject({ redriven: 1, inFlight: 1 });
    expect(deps.redrive).toHaveBeenCalledTimes(1);
    expect(deps.redrive).toHaveBeenCalledWith('stuck');
  });

  it('logs an error for an asset re-driven again and again', async () => {
    const deps = gcDeps({
      listPending: vi.fn().mockResolvedValue([{ id: 'a' }]),
      redrive: vi.fn().mockResolvedValue(REDRIVE_ALERT_AFTER),
    });
    await buildDeletionGc(deps)();
    expect(deps.logger.error).toHaveBeenCalledWith(
      { videoAssetId: 'a', redrives: REDRIVE_ALERT_AFTER },
      expect.stringContaining('keeps failing'),
    );
  });

  it('unpins leftover pipeline objects and sweeps output too', async () => {
    const deps = gcDeps({
      releaseObjects: vi.fn().mockResolvedValue({ released: 2, unpinned: 3, failed: 1 }),
      sweepOutput: vi.fn().mockResolvedValue(4),
    });
    expect(await buildDeletionGc(deps)()).toEqual({
      redriven: 0,
      inFlight: 0,
      released: 2,
      unpinned: 3,
      unpinFailed: 1,
      outputRemoved: 4,
    });
  });

  it('runs every part when one fails, then fails with that error', async () => {
    const deps = gcDeps({ listPending: vi.fn().mockRejectedValue(new Error('db down')) });
    await expect(buildDeletionGc(deps)()).rejects.toThrow('db down');
    expect(deps.releaseObjects).toHaveBeenCalled();
    expect(deps.sweepOutput).toHaveBeenCalled();
  });
});

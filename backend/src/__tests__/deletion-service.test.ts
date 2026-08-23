import { describe, it, expect, vi } from 'vitest';
import { buildDeleteAsset, buildDeletionGc } from '../deletion/service.js';

describe('buildDeleteAsset', () => {
  it('soft-deletes, captures object ids, and enqueues the unpin job', async () => {
    const softDelete = vi.fn().mockResolvedValue({ id: 'v1' });
    const collectObjectIds = vi.fn().mockResolvedValue(['o1', 'o2']);
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const deleteAsset = buildDeleteAsset({ softDelete, collectObjectIds, enqueue });
    const ok = await deleteAsset('v1', '0xowner');

    expect(ok).toBe(true);
    expect(softDelete).toHaveBeenCalledWith('v1', '0xowner');
    // Object ids are captured only after the soft-delete succeeds.
    expect(collectObjectIds).toHaveBeenCalledWith('v1');
    expect(enqueue).toHaveBeenCalledWith({ videoAssetId: 'v1', objectIds: ['o1', 'o2'] });
  });

  it('returns false and enqueues nothing when the soft-delete matches no row', async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const collectObjectIds = vi.fn();
    const enqueue = vi.fn();

    const deleteAsset = buildDeleteAsset({ softDelete, collectObjectIds, enqueue });
    const ok = await deleteAsset('missing', '0xowner');

    expect(ok).toBe(false);
    expect(collectObjectIds).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('buildDeletionGc', () => {
  it('re-enqueues a delete for every stuck asset and returns the count', async () => {
    const listPending = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const collectObjectIds = vi.fn(async (id: string) => [`${id}-o1`]);
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const gc = buildDeletionGc({
      listPending,
      collectObjectIds,
      enqueue,
      logger: { info: vi.fn() },
    });
    const count = await gc();

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledWith({ videoAssetId: 'a', objectIds: ['a-o1'] });
    expect(enqueue).toHaveBeenCalledWith({ videoAssetId: 'b', objectIds: ['b-o1'] });
  });

  it('does nothing when no assets are pending', async () => {
    const enqueue = vi.fn();
    const gc = buildDeletionGc({
      listPending: vi.fn().mockResolvedValue([]),
      collectObjectIds: vi.fn(),
      enqueue,
      logger: { info: vi.fn() },
    });
    expect(await gc()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { buildDeleteAsset, buildDeletionGc } from '../deletion/service.js';

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
  it('re-enqueues a delete for every stuck asset and returns the count', async () => {
    const listPending = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const gc = buildDeletionGc({ listPending, enqueue, logger: { info: vi.fn() } });
    const count = await gc();

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledWith('a');
    expect(enqueue).toHaveBeenCalledWith('b');
  });

  it('does nothing when no assets are pending', async () => {
    const enqueue = vi.fn();
    const gc = buildDeletionGc({
      listPending: vi.fn().mockResolvedValue([]),
      enqueue,
      logger: { info: vi.fn() },
    });
    expect(await gc()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

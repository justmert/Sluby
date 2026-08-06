import { describe, it, expect, vi } from 'vitest';
import {
  collectObjectIds,
  type ObjectEventLite,
  type ObjectsCursor,
} from '../reconcile/collect-inventory.js';

function ev(id: string, deleted: boolean, isoTime: string): ObjectEventLite {
  return { id, deleted, updatedAt: new Date(isoTime) };
}

describe('collectObjectIds', () => {
  it('returns the ids from a single short page, excluding deleted ones', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([
        ev('a', false, '2026-01-01T00:00:00Z'),
        ev('b', false, '2026-01-01T00:00:01Z'),
        ev('c', true, '2026-01-01T00:00:02Z'),
      ]);

    const ids = await collectObjectIds(fetchPage, { pageSize: 100 });

    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null, 100);
  });

  it('paginates until a page shorter than the page size, advancing the cursor', async () => {
    const page1 = [ev('a', false, '2026-01-01T00:00:00Z'), ev('b', false, '2026-01-01T00:00:01Z')];
    const page2 = [ev('c', false, '2026-01-01T00:00:02Z')];
    const fetchPage = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const ids = await collectObjectIds(fetchPage, { pageSize: 2 });

    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    // second call cursor derived from the last event of page 1
    const secondCallCursor = fetchPage.mock.calls[1][0] as ObjectsCursor;
    expect(secondCallCursor.id).toBe('b');
    expect(secondCallCursor.after.toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });

  it('applies last-write-wins so a later delete removes an earlier add', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce([
        ev('a', false, '2026-01-01T00:00:00Z'),
        ev('a', true, '2026-01-01T00:00:05Z'),
        ev('b', true, '2026-01-01T00:00:00Z'),
        ev('b', false, '2026-01-01T00:00:05Z'),
      ]);

    const ids = await collectObjectIds(fetchPage, { pageSize: 100 });

    expect(ids.has('a')).toBe(false); // added then deleted
    expect(ids.has('b')).toBe(true); // deleted then re-added
  });

  it('returns an empty set for an empty feed', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([]);
    const ids = await collectObjectIds(fetchPage, { pageSize: 50 });
    expect(ids.size).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops if the cursor fails to advance (defensive against a stuck feed)', async () => {
    // Every page returns the same full-size page — a misbehaving feed.
    const fetchPage = vi
      .fn()
      .mockResolvedValue([
        ev('a', false, '2026-01-01T00:00:00Z'),
        ev('a', false, '2026-01-01T00:00:00Z'),
      ]);

    const ids = await collectObjectIds(fetchPage, { pageSize: 2 });

    expect(ids.has('a')).toBe(true);
    // Must not loop forever: it detects the cursor did not move and stops.
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

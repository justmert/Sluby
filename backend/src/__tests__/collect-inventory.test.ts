import { describe, it, expect, vi } from 'vitest';
import {
  INDEXER_MAX_PAGE,
  syncObjectFeed,
  type FeedStore,
  type ObjectEventLite,
  type ObjectsCursor,
} from '../reconcile/collect-inventory.js';

function ev(id: string, deleted: boolean, isoTime: string): ObjectEventLite {
  return { id, deleted, updatedAt: new Date(isoTime) };
}

/** A FeedStore in memory, with what was saved after each page. */
function memoryStore(saved: { feed: string; cursor: ObjectsCursor | null } | null = null) {
  const objects = new Map<string, { deleted: boolean; eventAt: Date }>();
  const cursors: Array<ObjectsCursor | null> = [];
  let state = saved;
  const store: FeedStore = {
    begin: vi.fn(async (feed: string) => {
      if (state?.feed === feed) return state.cursor;
      objects.clear();
      state = { feed, cursor: null };
      return null;
    }),
    applyPage: vi.fn(async (feed: string, events: ObjectEventLite[], cursor) => {
      if (state?.feed !== feed) throw new Error('wrong feed');
      for (const e of events) {
        const prev = objects.get(e.id);
        if (!prev || prev.eventAt <= e.updatedAt) {
          objects.set(e.id, { deleted: e.deleted, eventAt: e.updatedAt });
        }
      }
      state = { feed, cursor };
      cursors.push(cursor);
    }),
    pruneDeleted: vi.fn(async (before: Date) => {
      for (const [id, o] of objects) if (o.deleted && o.eventAt < before) objects.delete(id);
    }),
  };
  return { store, objects, cursors, saved: () => state };
}

/**
 * An indexer stub that pages the way indexd does: events strictly after the
 * cursor in (updatedAt, id) order, with the cursor's time cut to milliseconds
 * as the SDK passes it.
 */
function indexer(events: ObjectEventLite[]) {
  const sorted = [...events].sort(
    (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || (a.id < b.id ? -1 : 1),
  );
  return vi.fn(async (cursor: ObjectsCursor | null, limit: number) =>
    sorted
      .filter(
        (e) =>
          !cursor ||
          e.updatedAt > cursor.after ||
          (e.updatedAt.getTime() === cursor.after.getTime() && e.id > cursor.id),
      )
      .slice(0, limit),
  );
}

const settled = new Date('2030-01-01T00:00:00Z');
const alive = (objects: Map<string, { deleted: boolean }>) =>
  [...objects].filter(([, o]) => !o.deleted).map(([id]) => id);

describe('syncObjectFeed', () => {
  it('reads the feed from the start into an empty copy, ending on a short page', async () => {
    const fetchPage = indexer([
      ev('a', false, '2026-01-01T00:00:00Z'),
      ev('b', false, '2026-01-01T00:00:01Z'),
      ev('c', true, '2026-01-01T00:00:02Z'),
    ]);
    const { store, objects } = memoryStore();

    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 100 });

    expect(alive(objects).sort()).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null, 100);
  });

  it('pages on until a short page, asking from the last event of each page', async () => {
    const fetchPage = indexer([
      ev('a', false, '2026-01-01T00:00:00Z'),
      ev('b', false, '2026-01-01T00:00:01Z'),
      ev('c', false, '2026-01-01T00:00:02Z'),
    ]);
    const { store, objects } = memoryStore();

    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 2 });

    expect(alive(objects).sort()).toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    const second = fetchPage.mock.calls[1][0] as ObjectsCursor;
    expect(second.id).toBe('b');
    expect(second.after.toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });

  it('resumes from the saved cursor and reads only what came after it', async () => {
    const fetchPage = indexer([
      ev('a', false, '2026-01-01T00:00:00Z'),
      ev('b', false, '2026-01-01T00:00:01Z'),
      ev('a', true, '2026-01-02T00:00:00Z'),
    ]);
    const { store, objects } = memoryStore({
      feed: 'f',
      cursor: { id: 'b', after: new Date('2026-01-01T00:00:01Z') },
    });
    objects.set('a', { deleted: false, eventAt: new Date('2026-01-01T00:00:00Z') });
    objects.set('b', { deleted: false, eventAt: new Date('2026-01-01T00:00:01Z') });

    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 10 });

    expect(fetchPage).toHaveBeenCalledWith(
      { id: 'b', after: new Date('2026-01-01T00:00:01Z') },
      10,
    );
    expect((await fetchPage.mock.results[0].value).map((e: ObjectEventLite) => e.id)).toEqual([
      'a',
    ]);
    expect(alive(objects)).toEqual(['b']);
  });

  it('starts the copy over for another feed', async () => {
    const fetchPage = indexer([ev('x', false, '2026-01-01T00:00:00Z')]);
    const { store, objects } = memoryStore({ feed: 'old', cursor: { id: 'z', after: settled } });
    objects.set('from-old-feed', { deleted: false, eventAt: new Date('2026-01-01T00:00:00Z') });

    await syncObjectFeed(fetchPage, store, { feed: 'new', settledBefore: settled });

    expect(fetchPage).toHaveBeenCalledWith(null, INDEXER_MAX_PAGE);
    expect(alive(objects)).toEqual(['x']);
  });

  it('fails when a full page does not get past the cursor, keeping the pages read so far', async () => {
    // more events in one millisecond than fit in a page: the cursor cannot move
    const sameMs = Array.from({ length: 3 }, (_, i) =>
      ev(`s${i}`, false, '2026-01-01T00:00:05.000Z'),
    );
    const before = [ev('a', false, '2026-01-01T00:00:00Z'), ev('b', false, '2026-01-01T00:00:01Z')];
    // the SDK hands back times cut to milliseconds; the indexer compares the
    // real, finer ones, so every request from inside that millisecond
    // returns the same events again
    const fetchPage = vi.fn(async (cursor: ObjectsCursor | null) =>
      cursor === null ? before : sameMs.slice(0, 2),
    );
    const { store, objects, saved } = memoryStore();

    await expect(
      syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 2 }),
    ).rejects.toThrow(/did not advance/);

    // a few requests, not an endless loop
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(3);
    expect(alive(objects).sort()).toEqual(['a', 'b', 's0', 's1']);
    // the next run resumes from what was read, not from the start
    expect(saved()?.cursor?.id).toBe('s1');
  });

  it('asks for at most the indexer’s maximum and takes a page shorter than that as the end', async () => {
    const fetchPage = indexer([ev('a', false, '2026-01-01T00:00:00Z')]);
    const { store } = memoryStore();

    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 1000 });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null, INDEXER_MAX_PAGE);
  });

  it('keeps the saved cursor before events newer than settledBefore, and applies them anyway', async () => {
    const fetchPage = indexer([
      ev('old', false, '2026-01-01T00:00:00Z'),
      ev('new', false, '2026-01-01T02:00:00Z'),
    ]);
    const { store, objects, saved } = memoryStore();

    await syncObjectFeed(fetchPage, store, {
      feed: 'f',
      settledBefore: new Date('2026-01-01T01:00:00Z'),
    });

    expect(alive(objects).sort()).toEqual(['new', 'old']);
    expect(saved()?.cursor).toEqual({ id: 'old', after: new Date('2026-01-01T00:00:00Z') });
  });

  it('never moves the saved cursor back for events read again', async () => {
    const fetchPage = vi.fn(async () => [ev('a', false, '2026-01-01T00:00:00Z')]);
    const start = { id: 'm', after: new Date('2026-01-01T00:00:00Z') };
    const { store, saved } = memoryStore({ feed: 'f', cursor: start });

    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 10 });

    expect(saved()?.cursor).toEqual(start);
  });

  it('applies events last-write-wins and forgets deletes older than settledBefore', async () => {
    const fetchPage = indexer([
      ev('a', false, '2026-01-01T00:00:00Z'),
      ev('gone', true, '2026-01-01T00:00:01Z'),
      ev('leaving', true, '2026-01-01T03:00:00Z'),
    ]);
    const { store, objects } = memoryStore();

    await syncObjectFeed(fetchPage, store, {
      feed: 'f',
      settledBefore: new Date('2026-01-01T02:00:00Z'),
    });

    expect([...objects.keys()].sort()).toEqual(['a', 'leaving']);
    expect(store.pruneDeleted).toHaveBeenCalledWith(new Date('2026-01-01T02:00:00Z'));
  });

  it('reads an empty feed with one request', async () => {
    const fetchPage = indexer([]);
    const { store, objects } = memoryStore();
    await syncObjectFeed(fetchPage, store, { feed: 'f', settledBefore: settled, pageSize: 50 });
    expect(objects.size).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

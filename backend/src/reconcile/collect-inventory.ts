/**
 * Keeps a saved copy of the indexer's object inventory up to date from its
 * object event feed.
 *
 * The `sia-storage` SDK has no "list all objects" call. What it offers is
 * `objectEvents(cursor, limit)`: the indexer keeps one event per object (its
 * latest pin or delete), ordered by (updatedAt, id), and returns the events
 * after a cursor. Applying them last-write-wins per id gives the inventory.
 * The copy and the cursor are saved (see FeedStore), so each run reads only
 * what changed since the last one instead of the whole feed.
 */

/** The minimal event shape this collector needs from the SDK. */
export interface ObjectEventLite {
  id: string;
  deleted: boolean;
  updatedAt: Date;
}

/** Cursor the SDK uses to resume the feed after a given event. */
export interface ObjectsCursor {
  id: string;
  after: Date;
}

export type FetchEventsPage = (
  cursor: ObjectsCursor | null,
  limit: number,
) => Promise<ObjectEventLite[]>;

/** Where the copy of the inventory and the feed's cursor are kept. */
export interface FeedStore {
  /**
   * The saved cursor to resume `feed` from, or null to read it from the
   * start. A copy built from another feed is dropped first.
   */
  begin: (feed: string) => Promise<ObjectsCursor | null>;
  /** Apply one page of events and save the cursor, atomically. */
  applyPage: (
    feed: string,
    events: ObjectEventLite[],
    cursor: ObjectsCursor | null,
  ) => Promise<void>;
  /** Forget deleted objects whose delete is older than `before`. */
  pruneDeleted: (before: Date) => Promise<void>;
}

/** The indexer rejects a larger limit (indexd's documented maximum). */
export const INDEXER_MAX_PAGE = 500;

/** (after, id) order, the order the indexer pages in; ids are lowercase hex. */
function isAfter(a: ObjectsCursor, b: ObjectsCursor | null): boolean {
  if (!b) return true;
  const t = a.after.getTime() - b.after.getTime();
  return t > 0 || (t === 0 && a.id > b.id);
}

const describeCursor = (c: ObjectsCursor | null) =>
  c ? `${c.after.toISOString()} / ${c.id}` : 'the start';

/**
 * Read the feed from the saved cursor to its end and apply it to the saved
 * copy.
 *
 * The end is a page shorter than the limit: the indexer pages with a plain
 * `LIMIT` and rejects limits above 500, so a short page means nothing is left.
 * A full page whose last event is not past the cursor it was asked from means
 * the feed cannot be paged further (the SDK passes times at millisecond
 * precision, so more than a page of events inside one millisecond stalls it).
 * That throws: carrying on would record every object not read yet as missing.
 *
 * The saved cursor only moves past events from before `settledBefore`. The
 * indexer stamps an event with its transaction's start time, so an event can
 * commit after later-stamped ones were already read; holding the cursor back
 * re-reads recent events on the next run, and applying them again is harmless.
 */
export async function syncObjectFeed(
  fetchPage: FetchEventsPage,
  store: FeedStore,
  opts: { feed: string; settledBefore: Date; pageSize?: number },
): Promise<{ events: number }> {
  const limit = Math.min(opts.pageSize ?? INDEXER_MAX_PAGE, INDEXER_MAX_PAGE);
  let cursor = await store.begin(opts.feed);
  let saved = cursor;
  let events = 0;

  for (;;) {
    const page = await fetchPage(cursor, limit);
    events += page.length;

    let settled = saved;
    for (const e of page) {
      const at: ObjectsCursor = { id: e.id, after: e.updatedAt };
      if (e.updatedAt <= opts.settledBefore && isAfter(at, settled)) settled = at;
    }
    await store.applyPage(opts.feed, page, settled);
    saved = settled;

    if (page.length < limit) break;
    const last = page[page.length - 1];
    const next: ObjectsCursor = { id: last.id, after: last.updatedAt };
    if (!isAfter(next, cursor)) {
      throw new Error(
        `the indexer's object feed did not advance past ${describeCursor(cursor)}: ` +
          `a full page of ${limit} events ended at ${describeCursor(next)}`,
      );
    }
    cursor = next;
  }

  await store.pruneDeleted(opts.settledBefore);
  return { events };
}

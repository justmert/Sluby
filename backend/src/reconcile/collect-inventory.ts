/**
 * Turns the indexer's object-event change feed into a snapshot of the
 * currently-pinned object ids.
 *
 * The `sia-storage` SDK does not expose a "list all objects" call. What it
 * offers is `objectEvents(cursor, limit)` — a cursor-paginated feed of
 * create/update/delete events ordered oldest-first. To reconstruct the
 * current inventory we replay the whole feed, applying last-write-wins per
 * id, and keep the ids whose most recent event is not a delete.
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

const DEFAULT_PAGE_SIZE = 500;

/**
 * Replay the object-event feed and return the set of ids currently pinned.
 *
 * Termination: we stop when a page comes back shorter than `pageSize` (the
 * feed is exhausted). As a defence against a misbehaving feed that keeps
 * returning full pages without advancing, we also stop if the derived
 * cursor does not move between iterations.
 */
export async function collectObjectIds(
  fetchPage: FetchEventsPage,
  opts?: { pageSize?: number },
): Promise<Set<string>> {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const latest = new Map<string, boolean>(); // id -> most recent `deleted`

  let cursor: ObjectsCursor | null = null;
  let lastCursorKey: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchPage(cursor, pageSize);
    for (const event of page) {
      latest.set(event.id, event.deleted);
    }

    if (page.length < pageSize) break;

    const last = page[page.length - 1];
    const nextCursor: ObjectsCursor = { id: last.id, after: last.updatedAt };
    const nextKey = `${nextCursor.id}@${nextCursor.after.getTime()}`;
    if (nextKey === lastCursorKey) break; // cursor did not advance — bail out
    lastCursorKey = nextKey;
    cursor = nextCursor;
  }

  const alive = new Set<string>();
  for (const [id, deleted] of latest) {
    if (!deleted) alive.add(id);
  }
  return alive;
}

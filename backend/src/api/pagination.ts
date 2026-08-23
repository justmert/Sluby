/**
 * Keyset (cursor) pagination helpers.
 *
 * A cursor is an opaque, URL-safe token that encodes the sort key of the
 * last row on a page — here the `(createdAt, id)` pair, which is a stable
 * total order over `video_assets` (createdAt is not unique on its own, so
 * id breaks ties). The next page is everything strictly "after" that key
 * in the sort direction, which is why keyset pagination stays correct even
 * when rows are inserted or deleted between requests (unlike OFFSET).
 */

/** The decoded sort key a cursor points at. */
export interface CursorKey {
  createdAt: Date;
  id: string;
}

/** Wire shape stored inside the token; short keys keep the token compact. */
interface CursorPayload {
  /** createdAt as an ISO-8601 string. */
  c: string;
  /** id. */
  i: string;
}

/**
 * Encode a row's sort key into an opaque, URL-safe cursor token.
 */
export function encodeCursor(key: CursorKey): string {
  const payload: CursorPayload = {
    c: key.createdAt.toISOString(),
    i: key.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor token back into a sort key. Returns null for any token
 * that is not a well-formed cursor (garbage input, wrong shape, or an
 * unparseable date) so callers can treat a bad cursor as "start from the
 * beginning" rather than crash.
 */
export function decodeCursor(token: string): CursorKey | null {
  if (!token) return null;
  let json: string;
  try {
    json = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as CursorPayload).c !== 'string' ||
    typeof (parsed as CursorPayload).i !== 'string'
  ) {
    return null;
  }

  const { c, i } = parsed as CursorPayload;
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) return null;

  // The id is interpolated into the keyset predicate as ::uuid, so a non-UUID
  // would raise a Postgres 22P02 instead of falling back to page one. Reject it
  // here so a malformed cursor behaves as documented (start from the beginning).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i)) {
    return null;
  }

  return { createdAt, id: i };
}

/** One page of results plus the cursor to fetch the next one. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Assemble a page from rows the caller over-fetched by one (limit + 1).
 * The extra "sentinel" row is how keyset pagination detects whether a next
 * page exists without a second COUNT query: if it's present there's more,
 * and it is trimmed from the returned data. The next cursor points at the
 * last row actually returned.
 */
export function paginateRows<T extends CursorKey>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { data, nextCursor, hasMore };
}

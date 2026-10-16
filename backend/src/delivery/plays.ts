import { createHash } from 'node:crypto';
import type { Request } from 'express';

/**
 * Plays, as this server can see them. A play is one player load of a video:
 *
 * - the gateway serving its master playlist with a 200, by video id or
 *   playback id at /v1/stream/{id}/master.m3u8, or as the master object at
 *   /v1/objects/{id} (signed playback urls point there);
 * - /v1/share/{id} minting the share map a player needs to play direct from
 *   Sia. Those players never fetch the master from the gateway, so this is
 *   the only request of theirs the server sees.
 *
 * Not counted: HEAD, 304 and range requests, refused or failed requests, the
 * share map refresh a long watch makes (the sdk marks it `renew=1`), and
 * previews in this server's own Studio (their Referer is a /studio page here).
 * The same viewer (address and user agent) loading the same video again within
 * DEDUPE_WINDOW_MS counts once, which also absorbs a player that reloads the
 * master after an error. Bytes are not counted: direct-from-Sia bytes never
 * pass this server.
 *
 * Counts are kept in memory and written every FLUSH_INTERVAL_MS as one upsert
 * per batch, so a play costs no database write of its own. A crash loses at
 * most the plays of the last interval.
 */

export const FLUSH_INTERVAL_MS = 10_000;
export const DEDUPE_WINDOW_MS = 30 * 60_000;
// past this many remembered viewers the oldest are forgotten first, which can
// only make a repeat count again, never lose a first play
const MAX_REMEMBERED_VIEWERS = 200_000;

export interface PlayRow {
  assetId: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  plays: number;
  lastPlayedAt: Date;
}

export interface PlayCounterDeps {
  write: (rows: PlayRow[]) => Promise<void>;
  onError: (err: unknown, rows: PlayRow[]) => void;
  now?: () => number;
}

export interface PlayCounter {
  /** Count a play of `assetId` by `viewer`; false when it was a repeat. */
  record: (assetId: string, viewer: string) => boolean;
  /** Write what is buffered now. */
  flush: () => Promise<void>;
  /** Flush every FLUSH_INTERVAL_MS until stop(). */
  start: (intervalMs?: number) => void;
  /** Stop the timer and write what is left. */
  stop: () => Promise<void>;
}

export function createPlayCounter(deps: PlayCounterDeps): PlayCounter {
  const now = deps.now ?? Date.now;
  // `${assetId} ${day}` to the buffered row
  let pending = new Map<string, PlayRow>();
  // `${assetId} ${viewer}` to when it was counted; a Map keeps insertion
  // order, so the oldest come first when pruning
  const seen = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const prune = (t: number) => {
    for (const [key, at] of seen) {
      if (t - at < DEDUPE_WINDOW_MS && seen.size <= MAX_REMEMBERED_VIEWERS) break;
      seen.delete(key);
    }
  };

  const flush = async () => {
    if (pending.size === 0) return;
    const rows = [...pending.values()];
    pending = new Map();
    try {
      await deps.write(rows);
    } catch (err) {
      deps.onError(err, rows);
    }
  };

  return {
    record(assetId, viewer) {
      const t = now();
      const key = `${assetId} ${viewer}`;
      const last = seen.get(key);
      if (last !== undefined && t - last < DEDUPE_WINDOW_MS) return false;
      seen.delete(key);
      seen.set(key, t);
      prune(t);
      const at = new Date(t);
      const day = at.toISOString().slice(0, 10);
      const bucket = `${assetId} ${day}`;
      const row = pending.get(bucket);
      if (row) {
        row.plays++;
        row.lastPlayedAt = at;
      } else {
        pending.set(bucket, { assetId, day, plays: 1, lastPlayedAt: at });
      }
      return true;
    },
    flush,
    start(intervalMs = FLUSH_INTERVAL_MS) {
      if (timer) return;
      timer = setInterval(() => void flush(), intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await flush();
    },
  };
}

/**
 * Who loaded the video, as far as a play count needs: a hash of the client
 * address and user agent, so raw addresses are not kept.
 */
export function viewerOf(req: Request): string {
  return createHash('sha256')
    .update(`${req.ip ?? ''}\n${req.get('user-agent') ?? ''}`)
    .digest('base64url')
    .slice(0, 22);
}

/** Whether the request comes from a page of this server's Studio (a preview). */
export function fromStudio(req: Request): boolean {
  const referer = req.get('referer');
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return url.host === req.get('host') && /^\/studio(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

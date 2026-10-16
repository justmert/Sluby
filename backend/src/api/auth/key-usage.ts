/**
 * When an API key was last used, kept to the minute. A busy key authenticates
 * many times a second, so writing every use would turn each request into a
 * write; at most one write per key per minute is plenty for "used 3 minutes
 * ago". The write never holds up the request it came from.
 */

export const KEY_USE_INTERVAL_MS = 60_000;

export interface KeyUseRecorderDeps {
  /** Store "used now" for the key; the query itself skips a fresh value. */
  write: (id: string) => Promise<void>;
  onError: (err: unknown, id: string) => void;
  now?: () => number;
}

/**
 * A function to call each time a key authenticates, with the last use the
 * database had for it. It writes when that value is missing or over a minute
 * old and this process has not written for the key in the last minute.
 */
export function createKeyUseRecorder(deps: KeyUseRecorderDeps) {
  const now = deps.now ?? Date.now;
  // key id to when this process last wrote it. stale entries are only
  // swept once the map gets large, since one entry per key is small
  const written = new Map<string, number>();

  return (id: string, lastUsedAt: Date | null): void => {
    const t = now();
    if (lastUsedAt && t - lastUsedAt.getTime() < KEY_USE_INTERVAL_MS) return;
    const last = written.get(id);
    if (last !== undefined && t - last < KEY_USE_INTERVAL_MS) return;
    if (written.size > 10_000) {
      for (const [k, at] of written) if (t - at >= KEY_USE_INTERVAL_MS) written.delete(k);
    }
    written.set(id, t);
    deps.write(id).catch((err: unknown) => {
      // let the next use try again
      written.delete(id);
      deps.onError(err, id);
    });
  };
}

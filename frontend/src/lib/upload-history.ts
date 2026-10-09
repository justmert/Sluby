/*
 * files this browser uploaded in the last 7 days, so picking one again can
 * say "You uploaded this file 2 days ago as “Teaser”." (FLW-47). Only the
 * file's identity is kept (name, type, size, date), never its contents. It
 * warns, it never blocks: uploading a file twice can be on purpose.
 */

const KEY = 'sluby:upload-history';
export const HISTORY_DAYS = 7;
const KEEP_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
// a browser that uploads all day should not grow this without bound
const MAX_ENTRIES = 200;

export interface UploadRecord {
  fingerprint: string;
  title: string;
  assetId: string;
  accountId: string;
  /** epoch ms of the upload */
  at: number;
}

function read(): UploadRecord[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (err) {
    console.warn('upload history: could not read localStorage', err);
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is UploadRecord =>
            typeof r?.fingerprint === 'string' &&
            typeof r.title === 'string' &&
            typeof r.assetId === 'string' &&
            typeof r.accountId === 'string' &&
            typeof r.at === 'number',
        )
      : [];
  } catch {
    // a damaged entry is worth nothing; the next write replaces it
    return [];
  }
}

function write(records: UploadRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch (err) {
    console.warn('upload history: could not write localStorage', err);
  }
}

/** Remember that this file became this video. */
export function recordUpload(record: Omit<UploadRecord, 'at'>, now = Date.now()): void {
  const fresh = read().filter(
    (r) =>
      now - r.at < KEEP_MS &&
      !(r.fingerprint === record.fingerprint && r.accountId === record.accountId),
  );
  write([{ ...record, at: now }, ...fresh].slice(0, MAX_ENTRIES));
}

/** The last time this account uploaded this file in this browser, within 7 days. */
export function findUpload(
  fingerprint: string,
  accountId: string,
  now = Date.now(),
): UploadRecord | null {
  return (
    read().find(
      (r) => r.fingerprint === fingerprint && r.accountId === accountId && now - r.at < KEEP_MS,
    ) ?? null
  );
}

/** Forget a video, for example once it was deleted. */
export function forgetUpload(assetId: string): void {
  const records = read();
  const kept = records.filter((r) => r.assetId !== assetId);
  if (kept.length !== records.length) write(kept);
}

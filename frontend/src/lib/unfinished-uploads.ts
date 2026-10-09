import type { AccessTier } from '@sluby/sdk';
import { ApiError } from '@/lib/api-client';

// tus-js-client keeps each resumable upload under
// `tus::<fingerprint>::<n>` in localStorage, and the sdk tags its fingerprints
// with `-sluby-`. A page reload drops the File, so these entries are all that
// is left of an upload that was cut off; picking the same file again with the
// same metadata makes the sdk resume it.
const PREFIX = 'tus::';
const SLUBY_TAG = '-sluby-';

export interface UnfinishedUpload {
  storageKey: string;
  uploadUrl: string;
  uploadId: string;
  fileName: string;
  fileType: string;
  size: number;
  title: string;
  description: string;
  accessTier: AccessTier;
  createdAt: string | null;
  /** Bytes the server holds, from a HEAD on the upload. */
  offset: number;
  assetId: string | null;
}

interface StoredEntry {
  size?: number;
  uploadUrl?: string;
  creationTime?: string;
  metadata?: Record<string, string>;
}

function uploadIdFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

function storedEntries(): Array<{ storageKey: string; entry: StoredEntry }> {
  const out: Array<{ storageKey: string; entry: StoredEntry }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (!storageKey?.startsWith(PREFIX) || !storageKey.includes(SLUBY_TAG)) continue;
    try {
      out.push({ storageKey, entry: JSON.parse(localStorage.getItem(storageKey) ?? 'null') });
    } catch {
      // tus skips entries it cannot parse too; they never resume anything
    }
  }
  return out;
}

function metadataAssetId(header: string | null): string | null {
  if (!header) return null;
  for (const pair of header.split(',')) {
    const [key, value] = pair.trim().split(' ');
    if (key === 'videoAssetId' && value) return atob(value);
  }
  return null;
}

/**
 * Ask the server about one stored upload: the upload as it stands now, or
 * null when the server no longer has it or has all of it (the stored entry
 * is removed then, the same way the sdk treats it when it looks for an
 * upload to resume).
 */
async function check(storageKey: string, entry: StoredEntry): Promise<UnfinishedUpload | null> {
  if (!entry?.uploadUrl || !entry.metadata) return null;
  const res = await fetch(entry.uploadUrl, {
    method: 'HEAD',
    headers: { 'Tus-Resumable': '1.0.0' },
  });
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
    localStorage.removeItem(storageKey);
    return null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Could not check an unfinished upload (HTTP ${res.status})`);
  }
  const offset = Number(res.headers.get('Upload-Offset'));
  const length = Number(res.headers.get('Upload-Length'));
  if (Number.isFinite(offset) && Number.isFinite(length) && offset >= length) {
    localStorage.removeItem(storageKey);
    return null;
  }
  const m = entry.metadata;
  return {
    storageKey,
    uploadUrl: entry.uploadUrl,
    uploadId: uploadIdFromUrl(entry.uploadUrl),
    fileName: m.filename ?? 'video',
    fileType: m.filetype ?? '',
    size: entry.size ?? length,
    title: m.title ?? '',
    description: m.description ?? '',
    accessTier: m.accessTier === 'private' ? 'private' : 'public',
    createdAt: entry.creationTime ?? null,
    offset: Number.isFinite(offset) ? offset : 0,
    assetId: metadataAssetId(res.headers.get('Upload-Metadata')),
  };
}

/** Unfinished uploads tus remembers, checked against the server. */
export async function findUnfinishedUploads(): Promise<UnfinishedUpload[]> {
  const found: UnfinishedUpload[] = [];
  for (const { storageKey, entry } of storedEntries()) {
    const upload = await check(storageKey, entry);
    if (upload) found.push(upload);
  }
  return found;
}

/**
 * Ask the server again right before resuming (FLW-04): the list may be
 * minutes old, and resuming an upload the server dropped would start a new
 * one under the old title. Null when it is gone or complete.
 */
export async function recheckUnfinishedUpload(
  upload: UnfinishedUpload,
): Promise<UnfinishedUpload | null> {
  const raw = localStorage.getItem(upload.storageKey);
  if (!raw) return null;
  let entry: StoredEntry;
  try {
    entry = JSON.parse(raw);
  } catch {
    localStorage.removeItem(upload.storageKey);
    return null;
  }
  return check(upload.storageKey, entry);
}

/**
 * Whether `file` is the file this upload was made from. tus fingerprints a
 * browser file as `tus-br-<name>-<type>-<size>-<lastModified>-<endpoint>`;
 * anything else would start a new upload instead of resuming this one.
 */
export function isSameFile(upload: UnfinishedUpload, file: File): boolean {
  const fingerprint = ['tus-br', file.name, file.type, file.size, file.lastModified].join('-');
  return upload.storageKey.startsWith(`${PREFIX}${fingerprint}-`);
}

/** Forget an unfinished upload, after the server dropped it. */
export function forgetUnfinishedUpload(storageKey: string): void {
  localStorage.removeItem(storageKey);
}

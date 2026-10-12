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

// which account started each upload, by upload id: the server answers 404 for
// another account's upload, which would otherwise read as gone and drop it
const OWNERS_KEY = 'sluby:upload-owners';
const OWNERS_MAX = 50;

function readOwners(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OWNERS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeOwners(owners: Record<string, string>) {
  try {
    // insertion order: the oldest go first once the map is full
    const kept = Object.entries(owners).slice(-OWNERS_MAX);
    localStorage.setItem(OWNERS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // storage full or blocked: the upload still works, only this hint is lost
  }
}

/** Note which account an upload belongs to, once the server gave it an id. */
export function rememberUploadOwner(uploadId: string, accountId: string): void {
  const owners = readOwners();
  if (owners[uploadId] === accountId) return;
  delete owners[uploadId];
  owners[uploadId] = accountId;
  writeOwners(owners);
}

function forgetUploadOwner(uploadId: string) {
  const owners = readOwners();
  if (!(uploadId in owners)) return;
  delete owners[uploadId];
  writeOwners(owners);
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

function sameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
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
    forgetUploadOwner(uploadIdFromUrl(entry.uploadUrl));
    return null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Could not check an unfinished upload (HTTP ${res.status})`);
  }
  const offset = Number(res.headers.get('Upload-Offset'));
  const length = Number(res.headers.get('Upload-Length'));
  if (Number.isFinite(offset) && Number.isFinite(length) && offset >= length) {
    localStorage.removeItem(storageKey);
    forgetUploadOwner(uploadIdFromUrl(entry.uploadUrl));
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

/**
 * Unfinished uploads tus remembers, checked against the server. With an
 * account, uploads another account started here are skipped, not dropped.
 */
export async function findUnfinishedUploads(accountId?: string): Promise<UnfinishedUpload[]> {
  const found: UnfinishedUpload[] = [];
  const owners = readOwners();
  for (const { storageKey, entry } of storedEntries()) {
    // an upload whose url is on another origin (the server's public url changed
    // since it started) can never resume from this page: the session cookie
    // does not go there and the browser blocks the request. asking would only
    // fail the whole list, so it is forgotten like one the server dropped
    if (entry?.uploadUrl && !sameOrigin(entry.uploadUrl)) {
      localStorage.removeItem(storageKey);
      forgetUploadOwner(uploadIdFromUrl(entry.uploadUrl));
      continue;
    }
    const owner = entry?.uploadUrl ? owners[uploadIdFromUrl(entry.uploadUrl)] : undefined;
    if (accountId && owner && owner !== accountId) continue;
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

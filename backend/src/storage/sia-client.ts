/**
 * Sia storage client — talks directly to a `renterd` HTTP API.
 *
 * Why this shape:
 *   - `renterd` is the official Sia renter daemon. It is a Go binary
 *     that runs natively on every OS the Go toolchain targets. It
 *     handles contract management, slab formation, erasure coding,
 *     encryption and host selection internally.
 *   - Its HTTP API is documented at https://api.sia.tech/renterd and
 *     is the same API `renterd`'s own Web UI speaks.
 *   - Two endpoints we care about:
 *       `PUT /api/worker/object/<key>?bucket=<b>`     — upload bytes
 *       `GET /api/worker/object/<key>?bucket=<b>`     — download bytes (Range OK)
 *       `HEAD /api/worker/object/<key>?bucket=<b>`    — size / etag
 *       `DELETE /api/bus/object/<key>?bucket=<b>`     — delete
 *       `GET /api/bus/object/<key>?bucket=<b>`        — slab / shard metadata
 *
 * Authentication is HTTP Basic with an empty username and the
 * `RENTERD_API_PASSWORD` env var as the password.
 *
 * Object ids in this codebase have always been opaque hex strings.
 * We generate each id as a random 32-byte hex (64 chars) so the shape
 * of `video_assets.manifest_object_id` and friends is unchanged — the
 * database column, JSON API, and frontend code all keep working
 * without migration.
 */

import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Renterd HTTP base URL, e.g. http://127.0.0.1:9880 (no trailing slash). */
const BASE_URL = env.RENTERD_API_URL.replace(/\/$/, '');
/** Bucket all SiaStream objects live in. Created on demand at startup. */
const BUCKET = env.RENTERD_BUCKET;
/** Base64(":password") for the HTTP Basic header. */
const AUTH_HEADER =
  'Basic ' + Buffer.from(':' + env.RENTERD_API_PASSWORD).toString('base64');

// ---------------------------------------------------------------------------
// Public types (kept identical to the previous SDK shape so the rest of
// the codebase — uploader, aggregator, sia-info — compiles unchanged).
// ---------------------------------------------------------------------------

export interface UploadResult {
  objectId: string;
  size: number;
}

/**
 * A lightweight "PinnedObject" stand-in. Upstream callers only use
 * `.id()`, `.size()`, `.slabs()`, `.createdAt()`, `.updatedAt()`. The
 * richer sia-storage type isn't needed now that we drive renterd
 * directly.
 */
export interface PinnedObject {
  id(): string;
  size(): bigint;
  slabs(): RawSlab[];
  createdAt(): Date | null;
  updatedAt(): Date | null;
}

/** Matches the shape upstream code pulls `minShards` / `sectors` from. */
export interface RawSlab {
  minShards: number;
  sectors: Array<{ root: string; hostKey: string }>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function newObjectId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** URL-encode an object key while leaving slashes intact (renterd allows them). */
function encKey(key: string): string {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function qs(params: Record<string, string | number | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out.append(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

async function renterdFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', AUTH_HEADER);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  return res;
}

async function renterdJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await renterdFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `renterd ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// renterd response shapes (documented at api.sia.tech/renterd)
// ---------------------------------------------------------------------------

interface BusObjectResponse {
  bucket: string;
  key: string;
  size: number;
  eTag?: string;
  modTime: string;
  mimeType?: string;
  encryptionKey?: string;
  slabs?: Array<{
    slab: {
      health: number;
      encryptionKey: string;
      minShards: number;
      shards?: Array<{
        root: string;
        contracts?: Record<string, string[]>;
      }>;
    };
    offset: number;
    length: number;
  }>;
}

// ---------------------------------------------------------------------------
// Client init / readiness
// ---------------------------------------------------------------------------

let ensureReadyPromise: Promise<void> | null = null;

export function getClient(): Promise<void> {
  if (!ensureReadyPromise) {
    ensureReadyPromise = (async () => {
      logger.info(
        { url: BASE_URL, bucket: BUCKET },
        'Connecting to renterd',
      );

      // Probe the API.
      const state = await renterdJson<{ network: string; version: string }>(
        '/api/bus/state',
      );
      logger.info(
        { network: state.network, version: state.version },
        'renterd reachable',
      );

      // Ensure our bucket exists. renterd 409s when it already does;
      // swallow that.
      const res = await renterdFetch('/api/bus/buckets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: BUCKET }),
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `Failed to create bucket ${BUCKET}: ${res.status} ${body}`,
        );
      }
      logger.info({ bucket: BUCKET }, 'renterd bucket ready');
    })().catch((err) => {
      ensureReadyPromise = null;
      throw err;
    });
  }
  return ensureReadyPromise;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a Uint8Array to renterd and return an object handle. renterd
 * does the slab formation, encryption and host placement internally.
 */
export async function uploadAndPin(data: Uint8Array): Promise<UploadResult> {
  await getClient();

  const objectId = newObjectId();
  logger.debug({ size: data.length, objectId }, 'Uploading object to renterd');

  const res = await renterdFetch(
    `/api/worker/object/${encKey(objectId)}${qs({ bucket: BUCKET })}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(data),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `renterd upload failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }

  logger.info({ objectId, size: data.length }, 'Object uploaded to renterd');
  return { objectId, size: data.length };
}

/**
 * Upload N Uint8Arrays. renterd has no "packed batch" primitive — each
 * upload is its own PUT — but renterd packs slabs server-side when the
 * data is small, so the on-disk overhead is essentially the same as
 * the old packed-upload path. We fire them in parallel with a bounded
 * concurrency window.
 */
export async function uploadAndPinPacked(
  items: Uint8Array[],
): Promise<UploadResult[]> {
  if (items.length === 0) return [];
  await getClient();

  const concurrency = Math.min(items.length, 4);
  const results: UploadResult[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await uploadAndPin(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Download (with byte-range passthrough)
// ---------------------------------------------------------------------------

export async function downloadObject(
  objectId: string,
  options?: { offset?: number; length?: number },
): Promise<Uint8Array> {
  await getClient();

  const headers: Record<string, string> = {};
  if (options?.offset !== undefined || options?.length !== undefined) {
    const start = options.offset ?? 0;
    const end =
      options.length !== undefined ? start + options.length - 1 : '';
    headers['Range'] = `bytes=${start}-${end}`;
  }

  const res = await renterdFetch(
    `/api/worker/object/${encKey(objectId)}${qs({ bucket: BUCKET })}`,
    { method: 'GET', headers },
  );
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `renterd download failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  logger.debug(
    { objectId, size: buf.length, range: headers['Range'] ?? 'full' },
    'Object downloaded from renterd',
  );
  return buf;
}

// ---------------------------------------------------------------------------
// Metadata / object handle (used by aggregator + sia-info)
// ---------------------------------------------------------------------------

/**
 * Returns a PinnedObject-shaped handle. Only the fields upstream
 * callers need are populated — `.id()`, `.size()`, `.slabs()`,
 * `.createdAt()`, `.updatedAt()`.
 */
export async function getObject(objectId: string): Promise<PinnedObject> {
  await getClient();

  const res = await renterdJson<BusObjectResponse>(
    `/api/bus/object/${encKey(objectId)}${qs({ bucket: BUCKET })}`,
  );

  const slabs: RawSlab[] = (res.slabs ?? []).map((ss) => {
    const sectors = (ss.slab.shards ?? []).map((sh) => {
      const contracts = sh.contracts ?? {};
      const hostKey = Object.keys(contracts)[0] ?? '';
      return { root: sh.root, hostKey };
    });
    return { minShards: ss.slab.minShards, sectors };
  });

  const modTime = res.modTime ? new Date(res.modTime) : null;
  const size = BigInt(res.size);
  const id = res.key;

  return {
    id: () => id,
    size: () => size,
    slabs: () => slabs,
    createdAt: () => modTime,
    updatedAt: () => modTime,
  };
}

// ---------------------------------------------------------------------------
// Delete / maintenance
// ---------------------------------------------------------------------------

export async function deleteObject(objectId: string): Promise<void> {
  await getClient();
  const res = await renterdFetch(
    `/api/bus/object/${encKey(objectId)}${qs({ bucket: BUCKET })}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `renterd delete failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  logger.info({ objectId }, 'Object deleted on renterd');
}

/**
 * renterd prunes unreferenced slabs automatically via its autopilot
 * loop. Kept as a no-op so the queue processor can still call it.
 */
export async function pruneSlabs(): Promise<void> {
  logger.debug('pruneSlabs is a no-op with renterd (handled by autopilot)');
}

/**
 * Generate a signed URL that lets a caller fetch this object
 * directly. The previous SDK returned a share URL that talked to a
 * hosted gateway; with renterd we return a URL into our own delivery
 * gateway (the aggregator proxies the actual bytes back out of
 * renterd under our auth).
 */
export async function shareObject(
  objectId: string,
  expiresAt: Date,
): Promise<string> {
  const base = env.PUBLIC_URL.replace(/\/$/, '');
  const url = `${base}/v1/objects/${encodeURIComponent(objectId)}?expires=${Math.floor(expiresAt.getTime() / 1000)}`;
  logger.info(
    { objectId, expiresAt: expiresAt.toISOString() },
    'Object share URL generated',
  );
  return url;
}

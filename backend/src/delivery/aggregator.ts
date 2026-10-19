import { Router, type Request, type Response } from 'express';
import { getSmallObject, peekCachedObject, getCacheStats } from '../storage/blob-manager.js';
import { openObject, isIndexerNotFound, type ObjectHandle } from '../storage/sia-client.js';
import { contentTypeForHint } from './content-type.js';
import { resolveObjectAccess, isObjectId, type ObjectAccess } from './access-control.js';
import { verifyObjectAccess, signManifestObjectUrls, type SigningState } from './signed-url.js';
import { ShareMintError, shareExpiryBounds } from './share-expiry.js';
import { createAssetShareUrls } from './share-urls.js';
import { getPlaybackIdByPublicId } from '../db/queries/playback-ids.js';
import { getVideoAssetById } from '../db/queries/assets.js';
import { isPlaybackId } from '../api/playback-id.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { playbackInitiationTotal, recordDelivery } from '../metrics/collector.js';
import { countPlay } from './play-recorder.js';

export const deliveryRouter = Router();

/**
 * Streaming gateway for Sia objects.
 *
 * Every request first settles access from the owning asset (access-control.ts):
 * a public asset's objects are open, a private asset's need a signed url, and
 * the objects of an asset being deleted, or of no asset, are not served. Then
 * the bytes, by request shape:
 *
 *  1. **Range request** (`Range: bytes=N-M`, `bytes=N-`, `bytes=-N`): one
 *     indexer lookup, then only the slabs the window overlaps are fetched
 *     from the hosts and streamed to the client as they arrive. Answered 206.
 *     HLS players send a range for every segment of the single-file
 *     renditions, so this is the media path.
 *
 *  2. **Whole object** (no usable Range): an object of up to 8 MB (manifests,
 *     playlists, thumbnails) is read once into the in-memory LRU and served
 *     from it; a larger one is streamed from Sia, uncached. Either way no
 *     request holds more than a small object, or a few chunks of a large one,
 *     in memory.
 *
 *  3. **HEAD** is the whole-object path without a body: a large object only
 *     costs the indexer lookup for its size.
 *
 * Caching. Public responses carry a strong ETag (the object id; objects never
 * change) and `Cache-Control: public, no-cache`, so a browser or CDN must ask
 * again before reusing a copy. Small public bodies also carry
 * `X-Accel-Expires`, which lets the shipped nginx keep them for
 * SHARED_CACHE_SECONDS; after that it revalidates, and this gateway answers
 * 304 only after checking access again. So an asset made private, revoked or
 * deleted stops being served within that window. Private responses are
 * `no-store` and errors are never cacheable.
 *
 * The entry points of a play (a master playlist and a share map) never carry
 * X-Accel-Expires, so every player load reaches this gateway and is counted
 * (see plays.ts). They are small and served from memory here.
 */

// how long the shipped nginx may serve a small public object before asking
// again; the bound on how long an access change takes to reach every viewer
export const SHARED_CACHE_SECONDS = 60;

const COMMON_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
} as const;

const PRIVATE_CACHE = { 'Cache-Control': 'no-store' } as const;

/** Headers for a public response: always revalidated, stored by nginx only when `shared`. */
function publicCache(etag: string, shared: boolean): Record<string, string> {
  return {
    'Cache-Control': 'public, no-cache',
    ETag: etag,
    ...(shared ? { 'X-Accel-Expires': String(SHARED_CACHE_SECONDS) } : {}),
  };
}

const etagFor = (id: string) => `"${id}"`;

/** Whether an If-None-Match or If-Range value names `etag`. */
function namesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}

/** A json error that no cache may keep. */
function fail(res: Response, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res
    .status(status)
    .set({ ...PRIVATE_CACHE, ...COMMON_CORS })
    .json(body);
}

/** The database could not answer, so neither serving nor refusing is known to be right. */
function unavailable(res: Response, err: unknown, ctx: Record<string, unknown>): void {
  logger.error({ ...ctx, err }, 'Delivery could not read the database');
  fail(res, 503, { error: 'Delivery is unavailable right now; try again' });
}

/** A failure from the indexer or the hosts while reading an object. */
function upstreamFailure(res: Response, err: unknown, objectId: string): void {
  if (isIndexerNotFound(err)) {
    // tracked but no longer on the indexer, e.g. unpinned moments ago
    logger.debug({ objectId }, 'Object not on the indexer');
    fail(res, 404, { error: 'Object not found', objectId });
    return;
  }
  logger.warn({ objectId, err }, 'Could not read object from Sia');
  fail(res, 502, { error: 'The Sia network did not answer; try again', objectId });
}

export function isManifestContent(data: Uint8Array): boolean {
  return data.length > 7 && data[0] === 0x23 && data[1] === 0x45;
}

/**
 * Detect the Content-Type for a binary object by inspecting magic bytes.
 * Covers the image formats we produce for thumbnails (JPEG, PNG, WebP,
 * GIF). Returns `application/octet-stream` as a safe fallback.
 */
export function detectBinaryContentType(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 && // R
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x46 && // F
    data[8] === 0x57 && // W
    data[9] === 0x45 && // E
    data[10] === 0x42 && // B
    data[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 && // G
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x38 // 8
  ) {
    return 'image/gif';
  }
  return 'application/octet-stream';
}

interface ParsedRange {
  start: number;
  end: number;
  chunkLength: number;
}

/**
 * Parse a single-range `Range` header against a known object size.
 *
 * Supported forms (RFC 7233 byte-range-spec):
 *   bytes=N-M   explicit window
 *   bytes=N-    from N to the end
 *   bytes=-N    the LAST N bytes (suffix range)
 *
 * Returns `null` when the header is absent or must be ignored (an invalid
 * spec such as first-byte-pos > last-byte-pos, or a multi-range request we
 * do not serve), in which case the caller falls back to a normal 200.
 * Returns `'unsatisfiable'` when the range starts beyond the object, which
 * must be answered with 416.
 *
 * Exported for testing: this arithmetic decides exactly which bytes a
 * player receives, so it is worth pinning down directly.
 */
export function parseRange(
  header: string | undefined,
  totalLength: number,
): ParsedRange | 'unsatisfiable' | null {
  if (!header) return null;

  // Suffix range: the final N bytes. Previously unhandled, which silently
  // downgraded such requests to a full-object read.
  const suffix = header.match(/^bytes=-(\d+)$/);
  if (suffix) {
    const wanted = parseInt(suffix[1], 10);
    if (!Number.isFinite(wanted) || wanted <= 0) return null;
    if (totalLength === 0) return 'unsatisfiable';
    const start = Math.max(0, totalLength - wanted);
    const end = totalLength - 1;
    return { start, end, chunkLength: end - start + 1 };
  }

  const m = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null; // multi-range or malformed: ignore the header
  const start = parseInt(m[1], 10);
  const end = m[2] === '' ? totalLength - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  // Order matters. An open-ended `bytes=N-` synthesizes end = totalLength-1
  // above, so for a start at or past EOF the inverted-spec check below would
  // also be true. Classify out-of-range FIRST, otherwise a seek past the end
  // degrades into "ignore the header" and serves the whole object with 200
  // instead of a cheap 416.
  if (start >= totalLength) return 'unsatisfiable';

  // A genuinely inverted spec (e.g. bytes=50-10) is an invalid header, which
  // RFC 7233 says to ignore rather than reject, so this is null.
  if (start > end) return null;

  const cappedEnd = Math.min(end, totalLength - 1);
  return { start, end: cappedEnd, chunkLength: cappedEnd - start + 1 };
}

/**
 * Stream `length` bytes to the client as they arrive from Sia, honouring the
 * client's backpressure. Waits for the first chunk before sending the status,
 * so a download that fails at once is still answered with an error status. A
 * stream that ends short or runs long is cut off, so the client sees a broken
 * response rather than wrong bytes, and a client that goes away cancels the
 * download.
 */
async function streamBody(
  res: Response,
  stream: ReadableStream<Uint8Array>,
  length: number,
  status: number,
  headers: Record<string, string>,
  objectId: string,
): Promise<number> {
  const reader = stream.getReader();
  let next = await reader.read();

  res.status(status).set(headers);
  let gone = false;
  const onClose = () => {
    gone = true;
    reader.cancel().catch(() => {});
  };
  res.on('close', onClose);

  let sent = 0;
  try {
    while (!next.done) {
      const chunk = next.value;
      if (sent + chunk.length > length) throw new Error('object stream ran past its length');
      sent += chunk.length;
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.on('drain', done);
          res.on('close', done);
        });
      }
      if (gone) return sent;
      next = await reader.read();
    }
    if (gone) return sent;
    if (sent !== length) throw new Error(`object stream ended at ${sent} of ${length} bytes`);
    res.end();
    return sent;
  } catch (err) {
    if (!gone) {
      logger.warn({ objectId, err, sent, length }, 'Object stream broke off');
      reader.cancel().catch(() => {});
      res.destroy(err as Error);
    }
    return sent;
  } finally {
    res.off('close', onClose);
  }
}

interface Grant {
  isPrivate: boolean;
  /** the asset's master playlist: not kept by nginx, so each load is counted */
  isMaster?: boolean;
  /** applied to a manifest body before sending, to sign its child urls */
  signManifest?: (text: string) => string;
}

/** The manifest signer for a verified capability. */
function manifestSigner(expiresAtSec: number, signing: SigningState) {
  return (text: string) =>
    signManifestObjectUrls(text, expiresAtSec, signing.generation, env.SESSION_SECRET);
}

/**
 * Serve the whole object (or, for HEAD, its headers). Small objects come from
 * the in-memory cache; large ones stream from Sia without being kept.
 */
async function serveWhole(
  req: Request,
  res: Response,
  objectId: string,
  grant: Grant,
  handle?: ObjectHandle,
): Promise<void> {
  const hint = req.query.type as string | undefined;
  const hinted = contentTypeForHint(hint);
  const head = req.method === 'HEAD';
  const result = await getSmallObject(objectId, handle ? { open: async () => handle } : undefined);

  if (result.kind === 'large') {
    const { size } = result.handle;
    const headers = {
      'Content-Type': hinted ?? 'application/octet-stream',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      ...(grant.isPrivate ? PRIVATE_CACHE : publicCache(etagFor(objectId), false)),
      'X-Cache-Status': 'BYPASS',
      ...COMMON_CORS,
    };
    if (head) {
      res.status(200).set(headers).end();
      return;
    }
    const sent = await streamBody(res, result.handle.read(), size, 200, headers, objectId);
    recordDelivery('object', sent);
    return;
  }

  const { data, status } = result;
  const manifest = hinted === 'application/vnd.apple.mpegurl' || isManifestContent(data);
  const body =
    manifest && grant.signManifest
      ? Buffer.from(grant.signManifest(new TextDecoder().decode(data)))
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  res.status(200).set({
    'Content-Type': manifest
      ? 'application/vnd.apple.mpegurl'
      : (hinted ?? detectBinaryContentType(data)),
    'Content-Length': String(body.length),
    'Accept-Ranges': 'bytes',
    ...(grant.isPrivate ? PRIVATE_CACHE : publicCache(etagFor(objectId), !grant.isMaster)),
    'X-Cache-Status': status,
    ...COMMON_CORS,
  });
  if (head) {
    res.end();
    return;
  }
  res.end(body);
  recordDelivery(manifest ? 'manifest' : 'object', body.length);
}

/**
 * Serve one byte range. One indexer lookup gives the size and the handle the
 * download uses; an object already in the memory cache needs neither.
 */
async function serveRange(
  req: Request,
  res: Response,
  objectId: string,
  rangeHeader: string,
  grant: Grant,
): Promise<void> {
  const hint = req.query.type as string | undefined;
  const etag = etagFor(objectId);
  const cache = grant.isPrivate ? PRIVATE_CACHE : publicCache(etag, false);

  const cached = peekCachedObject(objectId);
  let handle: ObjectHandle | undefined;
  const totalSize = cached ? cached.length : (handle = await openObject(objectId)).size;

  // a range that is invalid, multi-part, or conditional on another version is
  // ignored, which means the whole object
  const ifRange = req.headers['if-range'];
  const parsed =
    typeof ifRange === 'string' && !namesEtag(ifRange, etag)
      ? null
      : parseRange(rangeHeader, totalSize);
  if (parsed === null) {
    await serveWhole(req, res, objectId, grant, handle);
    return;
  }
  if (parsed === 'unsatisfiable') {
    res
      .status(416)
      .set({ 'Content-Range': `bytes */${totalSize}`, ...cache, ...COMMON_CORS })
      .end();
    return;
  }

  const headers = {
    // ranged reads are almost always fMP4 media; honour an explicit hint
    'Content-Type': contentTypeForHint(hint) ?? 'video/mp4',
    'Content-Length': String(parsed.chunkLength),
    'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalSize}`,
    'Accept-Ranges': 'bytes',
    ...cache,
    'X-Cache-Status': cached ? 'HIT' : 'BYPASS',
    ...COMMON_CORS,
  };

  if (cached) {
    res
      .status(206)
      .set(headers)
      .end(Buffer.from(cached.buffer, cached.byteOffset + parsed.start, parsed.chunkLength));
    recordDelivery('media', parsed.chunkLength);
    return;
  }

  logger.debug(
    { objectId, offset: parsed.start, length: parsed.chunkLength, totalSize },
    'Range-passthrough fetch from Sia',
  );
  const sent = await streamBody(
    res,
    handle!.read({ offset: parsed.start, length: parsed.chunkLength }),
    parsed.chunkLength,
    206,
    headers,
    objectId,
  );
  recordDelivery('media', sent);
}

/**
 * Preflights from players on other origins. Range is not a safelisted header
 * for every value a player sends, so a cross-origin seek can need one. nginx
 * answers these itself in the shipped stack; this covers a backend reached
 * directly. A preflight is cors plumbing rather than an operation, so it is
 * middleware and not a documented route.
 */
deliveryRouter.use((req: Request, res: Response, next) => {
  if (req.method !== 'OPTIONS' || !/^\/v1\/(objects|stream|share)\//.test(req.path)) {
    next();
    return;
  }
  res
    .status(204)
    .set({ ...COMMON_CORS, 'Access-Control-Max-Age': '86400' })
    .end();
});

/**
 * GET (and HEAD) /v1/objects/:objectId
 */
deliveryRouter.get('/v1/objects/:objectId', async (req: Request, res: Response) => {
  const objectId = String(req.params.objectId);
  if (!isObjectId(objectId)) {
    fail(res, 400, { error: 'Not a Sia object id (64 lowercase hex characters)', objectId });
    return;
  }

  let access: ObjectAccess;
  try {
    access = await resolveObjectAccess(objectId);
  } catch (err) {
    unavailable(res, err, { objectId });
    return;
  }

  // no asset claims it, or its asset is being deleted (its objects may not be
  // unpinned yet): not served either way
  if (access.kind === 'unknown' || access.kind === 'gone') {
    logger.debug({ objectId, access: access.kind }, 'Refused object without a live asset');
    fail(res, 404, { error: 'Object not found', objectId });
    return;
  }

  const grant: Grant = { isPrivate: access.kind === 'private', isMaster: access.isMaster };
  if (access.kind === 'private') {
    const check = verifyObjectAccess(
      objectId,
      req.query.expires as string | undefined,
      req.query.sig as string | undefined,
      access.signing,
      env.SESSION_SECRET,
      Math.floor(Date.now() / 1000),
    );
    if (!check.ok) {
      logger.debug({ objectId, reason: check.reason }, 'Rejected private object request');
      fail(res, 403, { error: 'This object requires a valid signed URL', reason: check.reason });
      return;
    }
    // a manifest's children are signed until the capability the caller proved ends
    grant.signManifest = manifestSigner(check.expiresAtSec, access.signing);
  } else if (namesEtag(req.headers['if-none-match'], etagFor(objectId))) {
    // still public: the copy the client (or nginx) holds may be used again
    res
      .status(304)
      .set({ ...publicCache(etagFor(objectId), !access.isMaster), ...COMMON_CORS })
      .end();
    return;
  }

  const rangeHeader = req.headers.range;
  try {
    if (rangeHeader && req.method !== 'HEAD') {
      await serveRange(req, res, objectId, rangeHeader, grant);
    } else {
      await serveWhole(req, res, objectId, grant);
      // a signed playback url points at the master object itself
      if (access.isMaster && res.statusCode === 200) countPlay(req, access.assetId);
    }
  } catch (err) {
    upstreamFailure(res, err, objectId);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedEntry {
  asset: {
    id: string;
    title: string;
    thumbnailObjectIds: string[];
    manifestObjectId: string | null;
    accessTier: string;
    status: string;
    signingGeneration: number;
    legacySignaturesUntil: Date | null;
  };
  policy: string;
}

/**
 * The asset behind a /v1/stream or /v1/share path segment (an asset UUID or
 * a pb_ playback id) and the policy of the handle used, or null when there is
 * no such live asset. Throws when the database cannot be read.
 */
export async function resolveEntry(param: string): Promise<ResolvedEntry | null> {
  let assetId = param;
  let policy = 'public';
  if (isPlaybackId(param)) {
    const pb = await getPlaybackIdByPublicId(param);
    if (!pb) return null;
    assetId = pb.videoAssetId;
    policy = pb.policy;
  } else if (!UUID_RE.test(param)) {
    return null;
  }
  const asset = await getVideoAssetById(assetId);
  return asset ? { asset, policy } : null;
}

export function signingStateOf(asset: ResolvedEntry['asset']): SigningState {
  return {
    generation: asset.signingGeneration,
    legacyUntilSec:
      asset.legacySignaturesUntil === null
        ? null
        : Math.floor(asset.legacySignaturesUntil.getTime() / 1000),
  };
}

/**
 * GET (and HEAD) /v1/stream/:videoAssetId/master.m3u8
 *
 * The master manifest by asset UUID or pb_ playback id. The entry point is
 * gated by the asset's tier and by the handle used: a private asset, or a
 * signed playback id even on a public asset, needs the `expires` and `sig` of
 * the asset's signed master url, and its child urls are then signed too. A
 * signed handle gates only this entry; the objects themselves follow the
 * asset's tier, so a public embed of the same asset keeps working.
 */
deliveryRouter.get('/v1/stream/:videoAssetId/master.m3u8', async (req: Request, res: Response) => {
  const param = String(req.params.videoAssetId);
  let entry: ResolvedEntry | null;
  try {
    entry = await resolveEntry(param);
  } catch (err) {
    unavailable(res, err, { param });
    return;
  }
  const manifestObjectId = entry?.asset.manifestObjectId;
  if (!entry || !manifestObjectId) {
    fail(res, 404, { error: 'Video asset not found or not ready' });
    return;
  }
  const { asset, policy } = entry;

  const requiresSigning = asset.accessTier === 'private' || policy === 'signed';
  let signManifest: ((text: string) => string) | undefined;
  const etag = etagFor(manifestObjectId);

  if (requiresSigning) {
    const signing = signingStateOf(asset);
    const check = verifyObjectAccess(
      manifestObjectId,
      req.query.expires as string | undefined,
      req.query.sig as string | undefined,
      signing,
      env.SESSION_SECRET,
      Math.floor(Date.now() / 1000),
    );
    if (!check.ok) {
      logger.debug({ param, reason: check.reason }, 'Rejected unsigned stream request');
      fail(res, 403, { error: 'This stream requires a valid signed URL', reason: check.reason });
      return;
    }
    signManifest = manifestSigner(check.expiresAtSec, signing);
  } else if (namesEtag(req.headers['if-none-match'], etag)) {
    res
      .status(304)
      .set({ ...publicCache(etag, false), ...COMMON_CORS })
      .end();
    return;
  }

  try {
    const result = await getSmallObject(manifestObjectId, { isManifest: true });
    if (result.kind !== 'cached') {
      throw new Error(`master manifest ${manifestObjectId} is ${result.handle.size} bytes`);
    }
    const { data, status } = result;
    const body = signManifest
      ? Buffer.from(signManifest(new TextDecoder().decode(data)))
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    res.status(200).set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': String(body.length),
      // a signed manifest is per request; a public one is the object's bytes
      ...(requiresSigning ? PRIVATE_CACHE : publicCache(etag, false)),
      'X-Cache-Status': status,
      ...COMMON_CORS,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
    recordDelivery('manifest', body.length);
    countPlay(req, asset.id);
  } catch (err) {
    upstreamFailure(res, err, manifestObjectId);
  }
});

/**
 * GET /v1/share/:id
 *
 * The sia:// share map for an asset or pb_ playback id, without credentials,
 * so a public page can play direct from Sia. Gated exactly like /v1/stream: a
 * private asset or a signed handle needs the same `expires` and `sig` as its
 * signed master url, and the shares never outlive that signature; a public
 * asset reached by its UUID or a public handle needs nothing. Minting goes
 * through the per-asset cache in share-urls.ts, whose gridded expiries bound
 * indexer calls per asset no matter how often or with which `expires_in` this
 * is called.
 */
deliveryRouter.get('/v1/share/:id', async (req: Request, res: Response) => {
  const param = String(req.params.id);
  let entry: ResolvedEntry | null;
  try {
    entry = await resolveEntry(param);
  } catch (err) {
    unavailable(res, err, { param });
    return;
  }
  const manifestObjectId = entry?.asset.manifestObjectId;
  if (!entry || !manifestObjectId || entry.asset.status !== 'ready') {
    fail(res, 404, { error: 'Video asset not found or not ready' });
    return;
  }
  const { asset, policy } = entry;

  const gated = asset.accessTier === 'private' || policy === 'signed';
  let signatureExpiresSec: number | undefined;
  if (gated) {
    const check = verifyObjectAccess(
      manifestObjectId,
      req.query.expires as string | undefined,
      req.query.sig as string | undefined,
      signingStateOf(asset),
      env.SESSION_SECRET,
      Math.floor(Date.now() / 1000),
    );
    if (!check.ok) {
      logger.debug({ param, reason: check.reason }, 'Rejected unsigned share map request');
      fail(res, 403, {
        error: 'This share map requires a valid signed URL',
        reason: check.reason,
      });
      return;
    }
    signatureExpiresSec = check.expiresAtSec;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const { expiresIn, notAfterSec } = shareExpiryBounds(
    req.query.expires_in,
    gated,
    nowSec,
    signatureExpiresSec,
  );

  let result: Awaited<ReturnType<typeof createAssetShareUrls>>;
  try {
    result = await createAssetShareUrls(asset.id, manifestObjectId, expiresIn, notAfterSec);
  } catch (err) {
    if (err instanceof ShareMintError && err.source === 'database') {
      unavailable(res, err, { assetId: asset.id });
      return;
    }
    logger.warn({ assetId: asset.id, err }, 'Could not mint share urls');
    fail(res, 502, {
      error: 'The Sia indexer did not answer while minting share URLs; try again',
    });
    return;
  }

  // never kept by a cache: each map is a player load to count (see plays.ts),
  // and minting is cheap here, since share-urls.ts keeps one map per asset and
  // expiry slot
  const cache = { 'Cache-Control': gated ? 'private, no-store' : 'no-store' };

  playbackInitiationTotal.inc({ mode: 'sia' });
  // the sdk marks the refresh of a map it already holds, which is the same play
  if (req.query.renew === undefined) countPlay(req, asset.id);
  res.set({ ...cache, ...COMMON_CORS }).json({
    master_object_id: result.masterObjectId,
    shares: result.shares,
    expires_at: result.expiresAt,
  });
});

/**
 * GET /v1/cache/stats
 */
deliveryRouter.get('/v1/cache/stats', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

import { Router, type Request, type Response } from 'express';
import { getCachedObject, getCacheStats } from '../storage/blob-manager.js';
import { downloadObject, getObject } from '../storage/sia-client.js';
import { contentTypeForHint } from './content-type.js';
import { getObjectAccessTier } from './access-control.js';
import { verifyObjectAccess, signManifestObjectUrls } from './signed-url.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const deliveryRouter = Router();

/**
 * Streaming gateway for Sia objects.
 *
 * Two distinct paths, chosen by request shape:
 *
 *  1. **Range request** (`Range: bytes=N-M` header present)
 *     → range-passthrough. Fetch ONLY the requested bytes from Sia via
 *       `downloadObject(id, {offset, length})`. Sia internally fetches
 *       only the slabs overlapping the byte range. Respond `206 Partial
 *       Content`. NO caching of partial bytes (each segment range is
 *       essentially unique). NO buffering of the full object in memory.
 *       This is how every modern streaming proxy (nginx, Cloudflare,
 *       Fastly) handles range traffic.
 *
 *  2. **Full GET** (no Range header)
 *     → cache-and-serve. Used by tiny files (manifests, thumbnails,
 *       playlists). Use the in-memory LRU; first miss pulls the whole
 *       object from Sia. Bounded by `CACHE_MAX_SIZE_MB`.
 *
 * Why this is the right architecture for Sia video:
 *  - HLS players ALWAYS send `Range:` for EXT-X-BYTERANGE segments.
 *  - Manifests/thumbnails are small (KBs) and benefit from RAM cache.
 *  - For a 2 GB video where a viewer watches 1 minute, we transfer
 *    only ~1 minute of bytes from Sia, not 2 GB.
 *  - First frame plays after one slab fetch (~1-2s), not after a full
 *    file download (~30s+).
 */

const COMMON_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
} as const;

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
 * Range-passthrough: fetch only the requested bytes from Sia.
 *
 * Steps:
 *  1. Look up object metadata (`getObject` is a single indexd HTTP call,
 *     no host fetch) to learn totalSize.
 *  2. Parse the Range header against totalSize.
 *  3. Call `downloadObject(id, {offset, length})` — Sia fetches only
 *     the overlapping slabs (~12 MiB each). Decoded bytes return.
 *  4. Respond `206 Partial Content` with proper Content-Range.
 *
 * No caching of partial bytes. The cache layer is bypassed entirely
 * for ranged reads.
 */
async function serveRange(
  req: Request,
  res: Response,
  objectId: string,
  rangeHeader: string,
  isPrivate = false,
): Promise<void> {
  const hint = req.query.type as string | undefined;

  // Cheap metadata-only lookup for size.
  const obj = await getObject(objectId);
  const totalSize = Number(obj.size());

  const parsed = parseRange(rangeHeader, totalSize);
  if (parsed === null) {
    // Malformed header — fall back to full GET behaviour.
    return serveFull(res, objectId, hint, { isPrivate });
  }
  if (parsed === 'unsatisfiable') {
    res
      .status(416)
      .set({
        'Content-Range': `bytes */${totalSize}`,
        ...COMMON_CORS,
      })
      .end();
    return;
  }

  logger.info(
    { objectId, offset: parsed.start, length: parsed.chunkLength, totalSize },
    'Range-passthrough fetch from Sia',
  );

  const bytes = await downloadObject(objectId, {
    offset: parsed.start,
    length: parsed.chunkLength,
  });

  res.status(206).set({
    // Ranged reads are almost always fMP4 media; honour an explicit hint
    // otherwise fall back to video/mp4.
    'Content-Type': contentTypeForHint(hint) ?? 'video/mp4',
    'Content-Length': bytes.length.toString(),
    'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalSize}`,
    'Accept-Ranges': 'bytes',
    // Private bytes must never be retained by a shared cache (nginx, CDN,
    // browser proxy); public media stays cacheable for a day.
    'Cache-Control': isPrivate ? 'no-store' : 'public, max-age=86400',
    // Ranged reads deliberately bypass the object cache.
    'X-Cache-Status': 'BYPASS',
    ...COMMON_CORS,
  });
  res.send(Buffer.from(bytes));
}

/**
 * Full GET: serve via the LRU cache. Intended for small objects only
 * (manifests, thumbnails). For large binary objects, players should
 * always send Range — if they don't, this still works but holds the
 * full file in RAM until LRU eviction.
 */
interface ServeFullOpts {
  /** Private objects are marked no-store and never cached by a shared proxy. */
  isPrivate?: boolean;
  /** Applied to a manifest body before sending, e.g. to sign child URLs. */
  signManifest?: (text: string) => string;
}

async function serveFull(
  res: Response,
  objectId: string,
  hint?: string,
  opts: ServeFullOpts = {},
): Promise<void> {
  const { data, status } = await getCachedObject(objectId, {
    isManifest: false,
  });
  const hinted = contentTypeForHint(hint);
  const { isPrivate = false, signManifest } = opts;

  if (hinted === 'application/vnd.apple.mpegurl' || isManifestContent(data)) {
    // For a private manifest, sign every child object URL so a single signed
    // link authorizes the whole graph. The body changes per request, so it is
    // never cached by a shared proxy.
    const text = signManifest ? signManifest(new TextDecoder().decode(data)) : null;
    const body = text !== null ? Buffer.from(text) : Buffer.from(data);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length.toString(),
      'Cache-Control': isPrivate ? 'no-store' : 'public, max-age=60',
      'Accept-Ranges': 'bytes',
      'X-Cache-Status': status,
      ...COMMON_CORS,
    });
    res.send(body);
    return;
  }

  res.set({
    'Content-Type': hinted ?? detectBinaryContentType(data),
    'Content-Length': data.length.toString(),
    'Cache-Control': isPrivate ? 'no-store' : 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
    'X-Cache-Status': status,
    ...COMMON_CORS,
  });
  res.send(Buffer.from(data));
}

/**
 * GET /v1/objects/:objectId
 */
deliveryRouter.get('/v1/objects/:objectId', async (req: Request, res: Response) => {
  const objectId = String(req.params.objectId);
  const rangeHeader = req.headers.range as string | undefined;
  const hint = req.query.type as string | undefined;

  try {
    // Objects belonging to a private asset require a valid, unexpired signed
    // URL. Public objects stay open so plain hls.js playback works.
    const tier = await getObjectAccessTier(objectId);
    const isPrivate = tier === 'private';
    let signManifest: ((text: string) => string) | undefined;

    if (isPrivate) {
      const check = verifyObjectAccess(
        objectId,
        req.query.expires as string | undefined,
        req.query.sig as string | undefined,
        env.SESSION_SECRET,
        Math.floor(Date.now() / 1000),
      );
      if (!check.ok) {
        logger.warn({ objectId, reason: check.reason }, 'Rejected private object request');
        res.status(403).set(COMMON_CORS).json({
          error: 'This object requires a valid signed URL',
          reason: check.reason,
        });
        return;
      }
      // The caller proved a valid capability at this expiry. When this object
      // is a manifest, re-use that same expiry to sign its child object URLs
      // so the variants and media segments are reachable too.
      const expiresAtSec = Number(req.query.expires);
      signManifest = (text: string) =>
        signManifestObjectUrls(text, expiresAtSec, env.SESSION_SECRET);
    }

    if (rangeHeader) {
      await serveRange(req, res, objectId, rangeHeader, isPrivate);
    } else {
      await serveFull(res, objectId, hint, { isPrivate, signManifest });
    }
  } catch (err) {
    logger.error({ objectId, err }, 'Failed to serve object');
    if (!res.headersSent) {
      res.status(404).json({ error: 'Object not found', objectId });
    }
  }
});

/**
 * GET /v1/stream/:videoAssetId/master.m3u8
 *
 * Convenience: look up the master manifest by video asset UUID and
 * serve it. Always uses the cache path (manifests are tiny).
 */
deliveryRouter.get('/v1/stream/:videoAssetId/master.m3u8', async (req: Request, res: Response) => {
  const param = String(req.params.videoAssetId);
  try {
    // Accept either an internal asset UUID or a public pb_... playback id.
    // A playback id also carries a policy ('public' | 'signed'); a signed
    // policy requires a signed URL even when the asset tier is public.
    const { getPlaybackIdByPublicId } = await import('../db/queries/playback-ids.js');
    const { isPlaybackId } = await import('../api/playback-id.js');

    let assetId = param;
    let policy = 'public';
    if (isPlaybackId(param)) {
      const pb = await getPlaybackIdByPublicId(param);
      if (!pb) {
        res.status(404).json({ error: 'Video asset not found or not ready' });
        return;
      }
      assetId = pb.videoAssetId;
      policy = pb.policy;
    }

    const { getVideoAssetById } = await import('../db/queries/assets.js');
    const asset = await getVideoAssetById(assetId);
    if (!asset?.manifestObjectId) {
      res.status(404).json({ error: 'Video asset not found or not ready' });
      return;
    }

    // Gate the entry point: a private asset, or a signed-policy playback id,
    // must present a valid signed URL over the master manifest object. This is
    // the same capability the object gateway checks, so /v1/stream cannot be
    // used to hand out a private manifest unsigned.
    const requiresSigning = asset.accessTier === 'private' || policy === 'signed';
    let signManifest: ((text: string) => string) | undefined;

    if (requiresSigning) {
      const check = verifyObjectAccess(
        asset.manifestObjectId,
        req.query.expires as string | undefined,
        req.query.sig as string | undefined,
        env.SESSION_SECRET,
        Math.floor(Date.now() / 1000),
      );
      if (!check.ok) {
        logger.warn({ param, reason: check.reason }, 'Rejected unsigned stream request');
        res.status(403).set(COMMON_CORS).json({
          error: 'This stream requires a valid signed URL',
          reason: check.reason,
        });
        return;
      }
      const expiresAtSec = Number(req.query.expires);
      signManifest = (text: string) =>
        signManifestObjectUrls(text, expiresAtSec, env.SESSION_SECRET);
    }

    const { data, status } = await getCachedObject(asset.manifestObjectId, {
      isManifest: true,
    });
    const body = signManifest
      ? Buffer.from(signManifest(new TextDecoder().decode(data)))
      : Buffer.from(data);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length.toString(),
      // A signed manifest is per-request and must never be cached by a shared
      // proxy; a public one is fine to cache briefly.
      'Cache-Control': requiresSigning ? 'no-store' : 'public, max-age=60',
      'X-Cache-Status': status,
      ...COMMON_CORS,
    });
    res.send(body);
  } catch (err) {
    logger.error({ param, err }, 'Failed to serve manifest');
    res.status(500).json({ error: 'Failed to serve manifest' });
  }
});

/**
 * GET /v1/cache/stats
 */
deliveryRouter.get('/v1/cache/stats', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

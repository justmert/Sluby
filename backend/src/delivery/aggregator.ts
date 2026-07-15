import { Router, type Request, type Response } from 'express';
import { getCachedObject, getCacheStats } from '../storage/blob-manager.js';
import {
  downloadObject,
  getObject,
} from '../storage/sia-client.js';
import { contentTypeForHint } from './content-type.js';
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

function isManifestContent(data: Uint8Array): boolean {
  return data.length > 7 && data[0] === 0x23 && data[1] === 0x45;
}

/**
 * Detect the Content-Type for a binary object by inspecting magic bytes.
 * Covers the image formats we produce for thumbnails (JPEG, PNG, WebP,
 * GIF). Returns `application/octet-stream` as a safe fallback.
 */
function detectBinaryContentType(data: Uint8Array): string {
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
 * Parse `Range: bytes=start-end` (end optional). Returns null for
 * absent/unparseable headers; returns `'unsatisfiable'` if the range
 * lies outside [0, totalLength).
 */
function parseRange(
  header: string | undefined,
  totalLength: number,
): ParsedRange | 'unsatisfiable' | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] === '' ? totalLength - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start >= totalLength || start > end) return 'unsatisfiable';
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
): Promise<void> {
  const hint = req.query.type as string | undefined;

  // Cheap metadata-only lookup for size.
  const obj = await getObject(objectId);
  const totalSize = Number(obj.size());

  const parsed = parseRange(rangeHeader, totalSize);
  if (parsed === null) {
    // Malformed header — fall back to full GET behaviour.
    return serveFull(res, objectId, hint);
  }
  if (parsed === 'unsatisfiable') {
    res.status(416).set({
      'Content-Range': `bytes */${totalSize}`,
      ...COMMON_CORS,
    }).end();
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
    'Cache-Control': 'public, max-age=86400',
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
async function serveFull(
  res: Response,
  objectId: string,
  hint?: string,
): Promise<void> {
  const { data, status } = await getCachedObject(objectId, {
    isManifest: false,
  });
  const hinted = contentTypeForHint(hint);

  if (hinted === 'application/vnd.apple.mpegurl' || isManifestContent(data)) {
    const body = Buffer.from(data);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length.toString(),
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=86400',
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
    if (rangeHeader) {
      await serveRange(req, res, objectId, rangeHeader);
    } else {
      await serveFull(res, objectId, hint);
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
    const { resolveAssetId } = await import('../db/queries/playback-ids.js');
    const assetId = await resolveAssetId(param);
    if (!assetId) {
      res.status(404).json({ error: 'Video asset not found or not ready' });
      return;
    }

    const { getVideoAssetById } = await import('../db/queries/assets.js');
    const asset = await getVideoAssetById(assetId);
    if (!asset?.manifestObjectId) {
      res.status(404).json({ error: 'Video asset not found or not ready' });
      return;
    }

    const { data, status } = await getCachedObject(asset.manifestObjectId, {
      isManifest: true,
    });
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': data.length.toString(),
      'Cache-Control': 'public, max-age=60',
      'X-Cache-Status': status,
      ...COMMON_CORS,
    });
    res.send(Buffer.from(data));
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

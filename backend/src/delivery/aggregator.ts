import { Router, type Request, type Response } from 'express';
import { getCachedObject, getCacheStats } from '../storage/blob-manager.js';
import { logger } from '../config/logger.js';

export const deliveryRouter = Router();

function isManifestContent(data: Uint8Array): boolean {
  // HLS manifests start with #EXTM3U
  return data.length > 7 && data[0] === 0x23 && data[1] === 0x45;
}

/**
 * Parse an HTTP Range header. Supports `bytes=start-end` and `bytes=start-`.
 * Returns null if header is missing/invalid (caller should serve full body).
 */
function parseRange(header: string | undefined, totalLength: number):
  | { start: number; end: number; chunkLength: number }
  | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] === '' ? totalLength - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalLength) {
    return null;
  }
  const cappedEnd = Math.min(end, totalLength - 1);
  return { start, end: cappedEnd, chunkLength: cappedEnd - start + 1 };
}

const COMMON_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
} as const;

/**
 * GET /v1/objects/:objectId
 *
 * Serve a Sia object — segment data file (with byte-range support),
 * playlist, or thumbnail.
 *
 * For HLS data files in single_file mode, the player issues
 * `Range: bytes=offset-end` for each segment based on the playlist's
 * EXT-X-BYTERANGE entries. We fetch the whole object once, cache it in
 * memory, and serve any requested slice. The Sia SDK supports native
 * byte-range downloads, but our LRU cache makes whole-object fetch
 * cheaper than repeated range fetches once warm.
 */
deliveryRouter.get('/v1/objects/:objectId', async (req: Request, res: Response) => {
  const objectId = String(req.params.objectId);

  try {
    const hintManifest =
      req.query.type === 'manifest' ||
      req.headers.accept?.includes('application/vnd.apple.mpegurl');

    const data = await getCachedObject(objectId, hintManifest);
    const isManifest = hintManifest || isManifestContent(data);

    if (isManifest) {
      const text = new TextDecoder().decode(data);
      const body = Buffer.from(text, 'utf-8');
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': body.length.toString(),
        'Cache-Control': 'public, max-age=60',
        ...COMMON_CORS,
      });
      res.send(body);
      return;
    }

    // Binary object — honor Range requests so HLS players can fetch
    // EXT-X-BYTERANGE segments out of the single data file.
    const range = parseRange(req.headers.range as string | undefined, data.length);
    const baseHeaders = {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      ...COMMON_CORS,
    };

    if (range) {
      const slice = Buffer.from(data.subarray(range.start, range.end + 1));
      res.status(206).set({
        ...baseHeaders,
        'Content-Length': slice.length.toString(),
        'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`,
      });
      res.send(slice);
    } else {
      res.set({
        ...baseHeaders,
        'Content-Length': data.length.toString(),
      });
      res.send(Buffer.from(data));
    }
  } catch (err) {
    logger.error({ objectId, err }, 'Failed to serve object');
    res.status(404).json({ error: 'Object not found', objectId });
  }
});

/**
 * GET /v1/stream/:videoAssetId/master.m3u8
 */
deliveryRouter.get('/v1/stream/:videoAssetId/master.m3u8', async (req: Request, res: Response) => {
  const videoAssetId = String(req.params.videoAssetId);

  try {
    const db = req.app.get('db');
    if (!db) {
      res.status(500).json({ error: 'Database not configured' });
      return;
    }

    const asset = await db.query.videoAssets?.findFirst({
      where: (va: { id: { equals: (id: string) => unknown } }) => va.id.equals(videoAssetId),
    });

    if (!asset?.manifestObjectId) {
      res.status(404).json({ error: 'Video asset not found or not ready' });
      return;
    }

    const data = await getCachedObject(asset.manifestObjectId, true);

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': data.length.toString(),
      'Cache-Control': 'public, max-age=60',
      ...COMMON_CORS,
    });

    res.send(Buffer.from(data));
  } catch (err) {
    logger.error({ videoAssetId, err }, 'Failed to serve manifest');
    res.status(500).json({ error: 'Failed to serve manifest' });
  }
});

/**
 * GET /v1/cache/stats
 */
deliveryRouter.get('/v1/cache/stats', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

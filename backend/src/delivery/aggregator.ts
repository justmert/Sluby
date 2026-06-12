import { Router, type Request, type Response } from 'express';
import { getCachedObject, getCacheStats } from '../storage/blob-manager.js';
import { logger } from '../config/logger.js';

export const deliveryRouter = Router();

function isManifestContent(data: Uint8Array): boolean {
  // HLS manifests start with #EXTM3U
  return data.length > 7 && data[0] === 0x23 && data[1] === 0x45;
}

/**
 * GET /v1/objects/:objectId
 *
 * Serve a Sia object (segment, init segment, manifest) with caching.
 * This is the main endpoint video players hit for HLS segments.
 */
deliveryRouter.get('/v1/objects/:objectId', async (req: Request, res: Response) => {
  const objectId = String(req.params.objectId);

  try {
    const hintManifest = req.query.type === 'manifest' ||
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      });
      res.send(body);
    } else {
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length.toString(),
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
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
 *
 * Serve the HLS master manifest for a video asset.
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
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

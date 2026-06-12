import { getCachedObject } from '../storage/blob-manager.js';
import { logger } from '../config/logger.js';

/**
 * Fetch and serve a manifest blob with appropriate headers.
 */
export async function serveManifest(manifestObjectId: string): Promise<{
  data: Uint8Array;
  headers: Record<string, string>;
}> {
  const data = await getCachedObject(manifestObjectId, true);

  return {
    data,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': data.length.toString(),
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    },
  };
}

/**
 * Fetch and serve a segment blob with appropriate headers.
 */
export async function serveSegment(objectId: string): Promise<{
  data: Uint8Array;
  headers: Record<string, string>;
}> {
  const data = await getCachedObject(objectId, false);

  return {
    data,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': data.length.toString(),
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    },
  };
}

/**
 * Pre-warm cache for a video by fetching its manifest and first few segments.
 */
export async function warmCache(manifestObjectId: string): Promise<void> {
  try {
    const manifestData = await getCachedObject(manifestObjectId, true);
    const content = new TextDecoder().decode(manifestData);

    // Parse object URLs from the manifest
    const objectUrlRegex = /\/v1\/blobs\/([^\s"]+)/g;
    let match;
    const objectIds: string[] = [];

    while ((match = objectUrlRegex.exec(content)) !== null) {
      objectIds.push(match[1]);
    }

    // Pre-fetch first few segments of each variant
    const prefetchCount = Math.min(3, objectIds.length);
    const prefetchPromises = objectIds.slice(0, prefetchCount).map(async (objectId) => {
      try {
        await getCachedObject(objectId, objectId.endsWith('.m3u8'));
      } catch (err) {
        logger.warn({ objectId, err }, 'Failed to pre-warm cache for object');
      }
    });

    await Promise.allSettled(prefetchPromises);

    logger.info({ manifestObjectId, prefetched: prefetchCount }, 'Cache warmed');
  } catch (err) {
    logger.warn({ manifestObjectId, err }, 'Failed to warm cache');
  }
}

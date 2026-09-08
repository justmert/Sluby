import { LRUCache } from 'lru-cache';
import { getAssetObjectIds } from '../db/queries/assets.js';
import { shareObjectUrl } from '../storage/sia-client.js';

/**
 * Per-playback capability map for direct-from-Sia delivery: a short-lived
 * `sia://` share URL for every object of one asset, plus which object is the
 * HLS master so the player knows where to start.
 *
 * Share URLs are public and non-revocable until they expire, so they are
 * minted fresh per playback session (short `validUntil`) and never baked into
 * the stored manifest. The browser player resolves each object via the web
 * SDK's `sharedObject(url)` and streams byte ranges directly from Sia — the
 * backend is not in the byte path.
 */
export interface AssetShareUrls {
  masterObjectId: string;
  /** object id (hex) -> sia:// share URL */
  shares: Record<string, string>;
  expiresAt: string;
}

// Minted maps are cached briefly so a popular asset does not re-hit indexd
// once per concurrent viewer. Keyed by (assetId, expiresIn, time bucket) so
// callers within the same short window share one map and one expiry.
const SHARE_CACHE_TTL_MS = 30_000;
const cache = new LRUCache<string, AssetShareUrls>({ max: 1000, ttl: SHARE_CACHE_TTL_MS });

/**
 * Enumerate every object of an asset and mint a share URL for each, valid for
 * `expiresIn` seconds. `masterObjectId` is echoed back so the caller need not
 * re-derive which object is the manifest master.
 */
export async function createAssetShareUrls(
  assetId: string,
  masterObjectId: string,
  expiresIn: number,
): Promise<AssetShareUrls> {
  const bucket = Math.floor(Date.now() / SHARE_CACHE_TTL_MS);
  const key = `${assetId}:${expiresIn}:${bucket}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const objectIds = await getAssetObjectIds(assetId);
  const validUntil = new Date(Date.now() + expiresIn * 1000);
  const entries = await Promise.all(
    objectIds.map(async (oid) => [oid, await shareObjectUrl(oid, validUntil)] as const),
  );

  const result: AssetShareUrls = {
    masterObjectId,
    shares: Object.fromEntries(entries),
    expiresAt: validUntil.toISOString(),
  };
  cache.set(key, result);
  return result;
}

import { LRUCache } from 'lru-cache';
import { getAssetObjectIds } from '../db/queries/assets.js';
import { shareObjectUrl } from '../storage/sia-client.js';
import { ShareMintError, shareExpirySec } from './share-expiry.js';

/**
 * Per-playback capability map for direct-from-Sia delivery: a short-lived
 * `sia://` share URL for every object of one asset, plus which object is the
 * HLS master so the player knows where to start.
 *
 * Share URLs are public and non-revocable until they expire, so they are
 * minted fresh per playback session (short `validUntil`) and never baked into
 * the stored manifest. The browser player resolves each object via the web
 * SDK's `objectFromShareUrl(url)` and streams byte ranges directly from Sia;
 * the backend is not in the byte path.
 */
export interface AssetShareUrls {
  masterObjectId: string;
  /** object id (hex) -> sia:// share URL */
  shares: Record<string, string>;
  expiresAt: string;
}

// keyed by asset, master and the gridded expiry (see share-expiry.ts), and
// kept until the urls expire, so each slot is minted once
const cache = new LRUCache<string, AssetShareUrls>({ max: 5000 });
// concurrent requests for a slot that is still being minted wait for that
// mint instead of starting their own
const inflight = new Map<string, Promise<AssetShareUrls>>();

/**
 * Enumerate every object of an asset and mint a share URL for each, valid for
 * about `expiresIn` seconds (see `shareExpirySec`) and never past
 * `notAfterSec`. `masterObjectId` is echoed back so the caller need not
 * re-derive which object is the manifest master.
 */
export async function createAssetShareUrls(
  assetId: string,
  masterObjectId: string,
  expiresIn: number,
  notAfterSec: number,
): Promise<AssetShareUrls> {
  const nowSec = Math.floor(Date.now() / 1000);
  const validUntilSec = shareExpirySec(nowSec, expiresIn, notAfterSec);
  // the master is part of the key so a re-processed asset never gets an old map
  const key = `${assetId}:${masterObjectId}:${validUntilSec}`;

  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const mint = (async () => {
    const objectIds = await getAssetObjectIds(assetId).catch((err: unknown) => {
      throw new ShareMintError('database', err);
    });
    const validUntil = new Date(validUntilSec * 1000);
    const entries = await Promise.all(
      objectIds.map(async (oid) => [oid, await shareObjectUrl(oid, validUntil)] as const),
    ).catch((err: unknown) => {
      throw new ShareMintError('indexer', err);
    });
    const result: AssetShareUrls = {
      masterObjectId,
      shares: Object.fromEntries(entries),
      expiresAt: validUntil.toISOString(),
    };
    // keep the map until its urls expire; nobody asks for this slot after that
    const ttl = validUntilSec * 1000 - Date.now();
    if (ttl > 0) cache.set(key, result, { ttl });
    return result;
  })();

  inflight.set(key, mint);
  try {
    return await mint;
  } finally {
    inflight.delete(key);
  }
}

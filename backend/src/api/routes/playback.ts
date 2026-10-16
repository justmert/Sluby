import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { playbackInitiationTotal } from '../../metrics/collector.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import { shareExpiryBounds } from '../../delivery/share-expiry.js';

export interface PlaybackRouteDeps {
  // `owner` is the caller's creatorAddress (undefined for a platform key).
  // Scoping the lookup by it stops a caller reading another tenant's asset
  // by guessing its id or playback id.
  getPlaybackAsset: (
    id: string,
    owner?: string,
  ) => Promise<{
    id: string;
    manifestObjectId: string | null;
    thumbnailObjectIds: string[];
    /** null until processing has measured it */
    durationMs: number | null;
    resolution: string | null;
    accessTier: string;
    status: string;
  } | null>;
  generateSignedUrl: (
    manifestObjectId: string,
    expiresIn: number,
  ) => Promise<{
    signedUrl: string;
    expiresAt: string;
  }>;
  // Mint per-object sia:// share URLs so the player can stream directly from
  // Sia. `masterObjectId` is the asset's manifest object; `expiresIn` is in
  // seconds and already clamped by the route, and `notAfterSec` (unix
  // seconds) is the tier cap the minted urls must not outlive.
  createShareUrls: (
    assetId: string,
    masterObjectId: string,
    expiresIn: number,
    notAfterSec: number,
  ) => Promise<{
    masterObjectId: string;
    shares: Record<string, string>;
    expiresAt: string;
  }>;
  // Delivery access tier for an object, so the share route gates the same way
  // the gateway does. Returns 'private' for a private-tier asset OR a
  // public-tier asset carrying a signed-policy playback id (a signed handle
  // gates the whole object graph, not just the /v1/stream entry).
  resolveObjectTier: (objectId: string) => Promise<'public' | 'private' | 'unknown' | 'gone'>;
}

export function createPlaybackRoutes(deps: PlaybackRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/playback/:id
   * Get playback info including the streaming URL for a video asset.
   */
  router.get('/:id', requireScope('read'), async (req: Request, res: Response) => {
    const asset = await deps.getPlaybackAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    if (asset.status !== 'ready') {
      throw new AppError(409, `Video is not ready for playback (status: ${asset.status})`);
    }

    if (!asset.manifestObjectId) {
      throw new AppError(409, 'Video manifest not available');
    }

    const playbackUrl = `/v1/objects/${asset.manifestObjectId}?type=manifest`;
    const posterUrl =
      asset.thumbnailObjectIds.length > 0 ? `/v1/objects/${asset.thumbnailObjectIds[0]}` : null;

    // the unsigned url of a private asset is still a handout, but not a public one
    playbackInitiationTotal.inc({ mode: asset.accessTier === 'private' ? 'private' : 'public' });
    res.json({
      playback_url: playbackUrl,
      poster_url: posterUrl,
      duration_ms: asset.durationMs,
      resolution: asset.resolution,
      access_tier: asset.accessTier,
    });
  });

  /**
   * GET /api/v1/playback/:id/signed
   * Get a time-limited signed playback URL (for private/gated content).
   */
  router.get('/:id/signed', requireScope('read'), async (req: Request, res: Response) => {
    const asset = await deps.getPlaybackAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    if (asset.status !== 'ready' || !asset.manifestObjectId) {
      throw new AppError(409, 'Video is not ready for playback');
    }

    const expiresIn = parseInt(req.query.expires_in as string) || 3600;

    const signed = await deps.generateSignedUrl(asset.manifestObjectId, expiresIn);

    // Serialize as snake_case to match the rest of the API and what the SDK
    // reads. The deps contract stays camelCase for internal callers.
    // a url minted already expired (a negative expires_in) starts no playback
    if (Date.parse(signed.expiresAt) > Date.now()) {
      playbackInitiationTotal.inc({ mode: 'signed' });
    }
    res.json({ signed_url: signed.signedUrl, expires_at: signed.expiresAt });
  });

  /**
   * GET /api/v1/playback/:id/share
   * Per-object sia:// share URLs so the player can download directly from Sia
   * (backend out of the byte path). Owner-scoped: only the asset's owner can
   * mint, and a leaked URL is bounded by a short expiry set here at mint time
   * (a sia:// URL bypasses the HMAC gateway entirely).
   */
  router.get('/:id/share', requireScope('read'), async (req: Request, res: Response) => {
    const asset = await deps.getPlaybackAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    if (asset.status !== 'ready' || !asset.manifestObjectId) {
      throw new AppError(409, 'Video is not ready for playback');
    }

    // Gate the same way the delivery gateway does: private tier OR a
    // signed-policy playback id both mean the content is access-controlled, so
    // its share URLs get the shorter cap and must not be cached. Checking only
    // asset.accessTier would hand a public-tier-but-signed asset a long-lived,
    // cacheable capability map that bypasses the gateway it opted into.
    const tier = await deps.resolveObjectTier(asset.manifestObjectId);
    const gated = tier === 'private' || asset.accessTier === 'private';

    const { expiresIn, notAfterSec } = shareExpiryBounds(
      req.query.expires_in,
      gated,
      Math.floor(Date.now() / 1000),
    );

    let result: Awaited<ReturnType<typeof deps.createShareUrls>>;
    try {
      result = await deps.createShareUrls(asset.id, asset.manifestObjectId, expiresIn, notAfterSec);
    } catch (err) {
      // minting talks to the indexer for every object; when that fails the
      // problem is upstream, so say so instead of answering a bare 500
      logger.warn({ assetId: asset.id, err }, 'Could not mint share urls');
      throw new AppError(502, 'The Sia indexer did not answer while minting share URLs; try again');
    }

    // A gated asset's capability map must not sit in a shared/proxy cache.
    if (gated) {
      res.setHeader('Cache-Control', 'private, no-store');
    }

    playbackInitiationTotal.inc({ mode: 'sia' });
    res.json({
      master_object_id: result.masterObjectId,
      shares: result.shares,
      expires_at: result.expiresAt,
    });
  });

  return router;
}

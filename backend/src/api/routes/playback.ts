import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { playbackInitiationTotal } from '../../metrics/collector.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import { ShareMintError, shareExpiryBounds } from '../../delivery/share-expiry.js';
import {
  DEFAULT_SIGNED_URL_TTL_SEC,
  MAX_SIGNED_URL_TTL_SEC,
  MIN_SIGNED_URL_TTL_SEC,
} from '../../delivery/signed-url.js';

export interface PlaybackAsset {
  id: string;
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  /** null until processing has measured it */
  durationMs: number | null;
  resolution: string | null;
  accessTier: string;
  status: string;
  /** part of every signed url of the asset; see delivery/signed-url.ts */
  signingGeneration: number;
}

export interface PlaybackRouteDeps {
  // `owner` is the caller's creatorAddress (the workspace). The lookup is
  // scoped by it like every other owner-scoped lookup.
  getPlaybackAsset: (id: string, owner?: string) => Promise<PlaybackAsset | null>;
  // Sign the asset's master manifest url (and its first thumbnail, when it
  // has one) for `expiresIn` seconds, already bounded by the route.
  generateSignedUrl: (
    asset: { manifestObjectId: string; posterObjectId: string | null; signingGeneration: number },
    expiresIn: number,
  ) => Promise<{
    signedUrl: string;
    posterUrl: string | null;
    expiresAt: string;
  }>;
  // Raise the asset's signing generation so every url signed before stops
  // working. Null when the caller has no such asset.
  revokeSignedUrls: (
    assetId: string,
    owner?: string,
  ) => Promise<{ signingGeneration: number } | null>;
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
}

/**
 * The lifetime a caller asked for, bounded to what a signed url may have. A
 * value that is not a whole number of seconds is refused rather than read as
 * the default, so a typo never quietly mints something else.
 */
function signedLifetime(raw: unknown): number {
  if (raw === undefined) return DEFAULT_SIGNED_URL_TTL_SEC;
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) {
    throw new AppError(400, 'expires_in must be a whole number of seconds');
  }
  return Math.min(Math.max(Number(raw), MIN_SIGNED_URL_TTL_SEC), MAX_SIGNED_URL_TTL_SEC);
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
   * Get a time-limited signed playback URL (for private/gated content), and a
   * poster url signed the same way.
   */
  router.get('/:id/signed', requireScope('read'), async (req: Request, res: Response) => {
    const expiresIn = signedLifetime(req.query.expires_in);
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

    const signed = await deps.generateSignedUrl(
      {
        manifestObjectId: asset.manifestObjectId,
        posterObjectId: asset.thumbnailObjectIds[0] ?? null,
        signingGeneration: asset.signingGeneration,
      },
      expiresIn,
    );

    playbackInitiationTotal.inc({ mode: 'signed' });
    // Serialize as snake_case to match the rest of the API and what the SDK
    // reads. The deps contract stays camelCase for internal callers.
    res.json({
      signed_url: signed.signedUrl,
      poster_url: signed.posterUrl,
      expires_at: signed.expiresAt,
    });
  });

  /**
   * POST /api/v1/playback/:id/signed/revoke
   * Stop every signed url of the asset minted so far, at once. New ones can
   * be minted right after.
   */
  router.post('/:id/signed/revoke', requireScope('manage'), async (req: Request, res: Response) => {
    const owner = ownerFilter(req.apiKey!.creatorAddress);
    const asset = await deps.getPlaybackAsset(String(req.params.id), owner);
    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }
    const revoked = await deps.revokeSignedUrls(asset.id, owner);
    if (!revoked) {
      throw new AppError(404, 'Video asset not found');
    }
    res.json({ success: true, signing_generation: revoked.signingGeneration });
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

    // a private asset's map gets the shorter cap and must not be cached; the
    // objects follow only the asset's tier, so a signed playback id on a
    // public asset changes nothing here
    const gated = asset.accessTier === 'private';

    const { expiresIn, notAfterSec } = shareExpiryBounds(
      req.query.expires_in,
      gated,
      Math.floor(Date.now() / 1000),
    );

    let result: Awaited<ReturnType<typeof deps.createShareUrls>>;
    try {
      result = await deps.createShareUrls(asset.id, asset.manifestObjectId, expiresIn, notAfterSec);
    } catch (err) {
      if (err instanceof ShareMintError && err.source === 'database') {
        logger.error({ assetId: asset.id, err }, 'Could not read the asset objects to mint');
        throw new AppError(503, 'The database did not answer while minting share URLs; try again');
      }
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

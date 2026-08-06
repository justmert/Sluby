import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';

export interface PlaybackRouteDeps {
  // `owner` is the caller's creatorAddress (undefined for a platform key).
  // Scoping the lookup by it stops a caller reading another tenant's asset
  // by guessing its id or playback id.
  getPlaybackAsset: (id: string, owner?: string) => Promise<{
    id: string;
    manifestObjectId: string | null;
    thumbnailObjectIds: string[];
    durationMs: number;
    resolution: string;
    accessTier: string;
    status: string;
  } | null>;
  generateSignedUrl: (manifestObjectId: string, expiresIn: number) => Promise<{
    signedUrl: string;
    expiresAt: string;
  }>;
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
    const posterUrl = asset.thumbnailObjectIds.length > 0
      ? `/v1/objects/${asset.thumbnailObjectIds[0]}`
      : null;

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
    res.json({ signed_url: signed.signedUrl, expires_at: signed.expiresAt });
  });

  return router;
}

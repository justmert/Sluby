import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';

export interface PlaybackIdRecord {
  id: string;
  playbackId: string;
  policy: string;
  name: string;
  createdAt: Date;
}

export interface PlaybackIdRouteDeps {
  /** Create a playback id for an asset; resolves null if the asset is unknown. */
  createPlaybackId: (
    assetId: string,
    opts: { policy?: string; name?: string },
  ) => Promise<PlaybackIdRecord | null>;
  listPlaybackIds: (assetId: string) => Promise<PlaybackIdRecord[]>;
  /** Delete by public playback id; resolves false if nothing was deleted. */
  deletePlaybackId: (playbackId: string) => Promise<boolean>;
}

const VALID_POLICIES = ['public', 'signed'];

function formatPlaybackId(r: PlaybackIdRecord) {
  return {
    id: r.id,
    playback_id: r.playbackId,
    policy: r.policy,
    name: r.name,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Playback ID management. Playback ids are public, rotatable handles that
 * map to a video asset, so a creator can embed and revoke access without
 * exposing the internal asset UUID.
 */
export function createPlaybackIdRoutes(deps: PlaybackIdRouteDeps): Router {
  const router = Router();

  /** POST /api/v1/assets/:assetId/playback-ids */
  router.post(
    '/assets/:assetId/playback-ids',
    requireScope('manage'),
    async (req: Request, res: Response) => {
      const { policy, name } = req.body ?? {};

      if (policy !== undefined && !VALID_POLICIES.includes(policy)) {
        throw new AppError(
          400,
          `Invalid policy '${policy}'. Must be one of: ${VALID_POLICIES.join(', ')}`,
        );
      }

      const created = await deps.createPlaybackId(String(req.params.assetId), {
        policy,
        name,
      });

      if (!created) {
        throw new AppError(404, 'Video asset not found');
      }

      res.status(201).json(formatPlaybackId(created));
    },
  );

  /** GET /api/v1/assets/:assetId/playback-ids */
  router.get(
    '/assets/:assetId/playback-ids',
    requireScope('read'),
    async (req: Request, res: Response) => {
      const rows = await deps.listPlaybackIds(String(req.params.assetId));
      res.json({ data: rows.map(formatPlaybackId) });
    },
  );

  /** DELETE /api/v1/playback-ids/:playbackId */
  router.delete(
    '/playback-ids/:playbackId',
    requireScope('manage'),
    async (req: Request, res: Response) => {
      const deleted = await deps.deletePlaybackId(String(req.params.playbackId));
      if (!deleted) {
        throw new AppError(404, 'Playback ID not found');
      }
      res.json({ success: true });
    },
  );

  return router;
}

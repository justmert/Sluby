import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../../config/logger.js';

export interface UploadRouteDeps {
  createUploadSession: (params: {
    apiKeyId: string;
    creatorAddress: string;
    title: string;
    description: string;
    accessTier: string;
  }) => Promise<{ videoAssetId: string; uploadUrl: string }>;
  getUploadStatus: (id: string) => Promise<{
    id: string;
    status: string;
    progressPercent: number;
    fileSize: number;
    uploadedBytes: number;
    videoAssetId: string | null;
  } | null>;
  cancelUpload: (id: string) => Promise<void>;
}

export function createUploadRoutes(deps: UploadRouteDeps): Router {
  const router = Router();

  /**
   * POST /api/v1/uploads
   * Create a new upload session and reserve a VideoAsset row.
   */
  router.post('/', requireScope('upload'), async (req: Request, res: Response) => {
    const { title, description, access_tier } = req.body;

    if (!title) {
      throw new AppError(400, 'Title is required');
    }

    try {
      const result = await deps.createUploadSession({
        apiKeyId: req.apiKey!.id,
        creatorAddress: req.apiKey!.creatorAddress,
        title,
        description: description ?? '',
        accessTier: access_tier ?? 'public',
      });

      res.status(201).json({
        video_asset_id: result.videoAssetId,
        upload_url: result.uploadUrl,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to create upload session');
      throw new AppError(500, 'Failed to create upload session');
    }
  });

  /**
   * GET /api/v1/uploads/:id
   * Get upload session status and progress.
   */
  router.get('/:id', requireScope('read'), async (req: Request, res: Response) => {
    const status = await deps.getUploadStatus(String(req.params.id));

    if (!status) {
      throw new AppError(404, 'Upload session not found');
    }

    res.json(status);
  });

  /**
   * DELETE /api/v1/uploads/:id
   * Cancel an upload session.
   */
  router.delete('/:id', requireScope('upload'), async (req: Request, res: Response) => {
    await deps.cancelUpload(String(req.params.id));
    res.json({ success: true });
  });

  return router;
}

import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';

export interface UploadRouteDeps {
  // `owner` is the caller's creatorAddress (undefined for a platform key).
  // Scoping the lookup by it stops one tenant reading or cancelling another
  // tenant's upload session by guessing its id (the id rides in the upload URL).
  getUploadStatus: (
    id: string,
    owner?: string,
  ) => Promise<{
    id: string;
    status: string;
    progressPercent: number;
    fileSize: number;
    uploadedBytes: number;
    videoAssetId: string | null;
  } | null>;
  cancelUpload: (id: string, owner?: string) => Promise<boolean>;
}

export function createUploadRoutes(deps: UploadRouteDeps): Router {
  const router = Router();

  // NOTE: creating an upload is done through the TUS protocol at the collection
  // endpoint `POST /api/v1/uploads` (handled by the TUS server, which mints the
  // asset as the upload begins). There is deliberately no JSON session-creation
  // route: it would produce an asset that the TUS flow can never upload to.

  /**
   * GET /api/v1/uploads/:id
   * Get upload session status and progress.
   */
  router.get('/:id', requireScope('read'), async (req: Request, res: Response) => {
    const status = await deps.getUploadStatus(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!status) {
      throw new AppError(404, 'Upload session not found');
    }

    // Serialize snake_case to match the rest of the API and what the SDK reads.
    res.json({
      id: status.id,
      video_asset_id: status.videoAssetId,
      status: status.status,
      progress_percent: status.progressPercent,
      file_size: status.fileSize,
      uploaded_bytes: status.uploadedBytes,
    });
  });

  /**
   * DELETE /api/v1/uploads/:id
   * Cancel an upload session.
   */
  router.delete('/:id', requireScope('upload'), async (req: Request, res: Response) => {
    const cancelled = await deps.cancelUpload(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!cancelled) {
      throw new AppError(404, 'Upload session not found');
    }

    res.json({ success: true });
  });

  return router;
}

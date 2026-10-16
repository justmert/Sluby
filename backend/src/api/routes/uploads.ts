import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';

export interface UploadRouteDeps {
  // `id` is the tus upload id, the last segment of the Location a tus
  // creation answers with. `owner` is the caller's creatorAddress (undefined
  // for a platform key); scoping by it stops one tenant reading or cancelling
  // another tenant's upload.
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
  /** Cancel an upload still in progress and discard the asset it created. */
  cancelUpload: (
    id: string,
    owner?: string,
  ) => Promise<'cancelled' | 'not_found' | 'not_uploading'>;
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
   * Cancel an upload in progress, like a tus DELETE: the partial file and
   * the asset it created go. A finished upload is the source of its asset
   * and cannot be cancelled; delete the asset instead.
   */
  router.delete('/:id', requireScope('upload'), async (req: Request, res: Response) => {
    const outcome = await deps.cancelUpload(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (outcome === 'not_found') {
      throw new AppError(404, 'Upload session not found');
    }
    if (outcome === 'not_uploading') {
      throw new AppError(
        409,
        'The upload is no longer in progress; delete its asset instead of cancelling it',
      );
    }

    res.json({ success: true });
  });

  return router;
}

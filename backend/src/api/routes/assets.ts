import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';

export interface ProcessingJobRecord {
  id: string;
  status: string;
  progressPercent: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  logs: Array<{ timestamp: string; stage: string; message: string }> | null;
}

export interface AssetRouteDeps {
  listAssets: (params: {
    page: number;
    limit: number;
    status?: string;
    accessTier?: string;
    creatorAddress?: string;
  }) => Promise<{ data: VideoAssetRecord[]; total: number }>;
  getAsset: (id: string) => Promise<VideoAssetRecord | null>;
  updateAsset: (id: string, data: {
    title?: string;
    description?: string;
    accessTier?: string;
  }) => Promise<VideoAssetRecord | null>;
  deleteAsset: (id: string) => Promise<void>;
  getProcessingJob: (videoAssetId: string) => Promise<ProcessingJobRecord | undefined>;
  retryAsset: (id: string) => Promise<{ stage: string }>;
}

interface VideoAssetRecord {
  id: string;
  title: string;
  description: string;
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  durationMs: number;
  resolution: string;
  status: string;
  accessTier: string;
  creatorAddress: string;
  segmentCount: number;
  totalStorageBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export function createAssetRoutes(deps: AssetRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/assets
   * List video assets with pagination and filtering.
   */
  router.get('/', requireScope('read'), async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;
    const accessTier = req.query.access_tier as string | undefined;

    const result = await deps.listAssets({
      page,
      limit,
      status,
      accessTier,
      creatorAddress: req.apiKey!.creatorAddress === '0x0000000000000000000000000000000000000000000000000000000000000000'
        ? undefined
        : req.apiKey!.creatorAddress,
    });

    res.json({
      data: result.data.map(formatAsset),
      total: result.total,
      page,
      limit,
    });
  });

  /**
   * GET /api/v1/assets/:id
   * Get a single video asset by ID.
   */
  router.get('/:id', requireScope('read'), async (req: Request, res: Response) => {
    const asset = await deps.getAsset(String(req.params.id));

    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    res.json(formatAsset(asset));
  });

  /**
   * PATCH /api/v1/assets/:id
   * Update video asset metadata.
   */
  router.patch('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const { title, description, access_tier } = req.body;

    const updated = await deps.updateAsset(String(req.params.id), {
      title,
      description,
      accessTier: access_tier,
    });

    if (!updated) {
      throw new AppError(404, 'Video asset not found');
    }

    res.json(formatAsset(updated));
  });

  /**
   * DELETE /api/v1/assets/:id
   * Delete a video asset.
   */
  router.delete('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    await deps.deleteAsset(String(req.params.id));
    res.json({ success: true });
  });

  /**
   * GET /api/v1/assets/:id/processing
   * Get the processing job progress for a video asset.
   */
  router.get('/:id/processing', requireScope('read'), async (req: Request, res: Response) => {
    const job = await deps.getProcessingJob(String(req.params.id));

    if (!job) {
      throw new AppError(404, 'No processing job found for this asset');
    }

    res.json({
      id: job.id,
      status: job.status,
      progress_percent: job.progressPercent,
      error_message: job.errorMessage,
      started_at: job.startedAt?.toISOString() ?? null,
      completed_at: job.completedAt?.toISOString() ?? null,
      created_at: job.createdAt.toISOString(),
      logs: job.logs ?? [],
    });
  });

  /**
   * POST /api/v1/assets/:id/retry
   * Retry processing a failed video asset.
   */
  router.post('/:id/retry', requireScope('manage'), async (req: Request, res: Response) => {
    const result = await deps.retryAsset(String(req.params.id));
    res.json({ success: true, stage: result.stage });
  });

  return router;
}

function formatAsset(asset: VideoAssetRecord) {
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    manifest_object_id: asset.manifestObjectId,
    thumbnail_object_ids: asset.thumbnailObjectIds,
    duration_ms: asset.durationMs,
    resolution: asset.resolution,
    status: asset.status,
    access_tier: asset.accessTier,
    creator_address: asset.creatorAddress,
    segment_count: asset.segmentCount,
    total_storage_bytes: asset.totalStorageBytes,
    created_at: asset.createdAt.toISOString(),
    updated_at: asset.updatedAt.toISOString(),
  };
}

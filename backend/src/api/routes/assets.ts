import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
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
    cursor?: string;
    status?: string;
    accessTier?: string;
    creatorAddress?: string;
  }) => Promise<{
    data: VideoAssetRecord[];
    total: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  }>;
  // `owner` is the caller's creatorAddress, or undefined for a platform key.
  // Every by-id operation is scoped by it so one tenant cannot reach
  // another's asset by guessing a UUID.
  getAsset: (id: string, owner?: string) => Promise<VideoAssetRecord | null>;
  updateAsset: (
    id: string,
    data: {
      title?: string;
      description?: string;
      accessTier?: string;
    },
    owner?: string,
  ) => Promise<VideoAssetRecord | null>;
  deleteAsset: (id: string, owner?: string) => Promise<boolean>;
  getProcessingJob: (
    videoAssetId: string,
    owner?: string,
  ) => Promise<ProcessingJobRecord | undefined>;
  retryAsset: (id: string, owner?: string) => Promise<{ stage: string }>;
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

/** Mirrors the `access_tier` enum in the database schema. */
const VALID_ACCESS_TIERS = ['public', 'private'];

export function createAssetRoutes(deps: AssetRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/assets
   * List video assets with pagination and filtering.
   */
  router.get('/', requireScope('read'), async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const cursor = (req.query.cursor as string | undefined) || undefined;
    const status = req.query.status as string | undefined;
    const accessTier = req.query.access_tier as string | undefined;

    const result = await deps.listAssets({
      page,
      limit,
      cursor,
      status,
      accessTier,
      creatorAddress: ownerFilter(req.apiKey!.creatorAddress),
    });

    res.json({
      data: result.data.map(formatAsset),
      total: result.total,
      page,
      limit,
      // Cursor pagination: pass `next_cursor` back as `?cursor=` to page
      // forward. `page`/`limit`/`total` remain for offset-style callers.
      next_cursor: result.nextCursor ?? null,
      has_more: result.hasMore ?? false,
    });
  });

  /**
   * GET /api/v1/assets/:id
   * Get a single video asset by ID.
   */
  router.get('/:id', requireScope('read'), async (req: Request, res: Response) => {
    const asset = await deps.getAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    // A miss here can mean "no such asset" or "not yours"; both answer 404 so
    // the endpoint does not leak the existence of another tenant's asset.
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

    if (access_tier !== undefined && !VALID_ACCESS_TIERS.includes(access_tier)) {
      throw new AppError(
        400,
        `Invalid access_tier '${access_tier}'. Must be one of: ${VALID_ACCESS_TIERS.join(', ')}`,
      );
    }

    const updated = await deps.updateAsset(
      String(req.params.id),
      { title, description, accessTier: access_tier },
      ownerFilter(req.apiKey!.creatorAddress),
    );

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
    const deleted = await deps.deleteAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

    if (!deleted) {
      throw new AppError(404, 'Video asset not found');
    }

    // The asset is soft-deleted synchronously; its Sia objects are unpinned by
    // a background worker. `deleting` tells the caller the async part is queued.
    res.json({ success: true, status: 'deleting' });
  });

  /**
   * GET /api/v1/assets/:id/processing
   * Get the processing job progress for a video asset.
   */
  router.get('/:id/processing', requireScope('read'), async (req: Request, res: Response) => {
    const job = await deps.getProcessingJob(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );

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
    const result = await deps.retryAsset(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
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

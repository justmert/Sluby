import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import {
  ASSET_SORT_FIELDS,
  isDefaultAssetOrder,
  type AssetSortField,
  type SortOrder,
} from '../asset-sort.js';

const ASSET_STATUSES = ['created', 'uploading', 'processing', 'ready', 'failed'];

export interface ProcessingJobRecord {
  id: string;
  status: string;
  progressPercent: number;
  retryCount: number;
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
    search?: string;
    sort?: AssetSortField;
    order?: SortOrder;
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
    const status = (req.query.status as string | undefined) || undefined;
    const accessTier = (req.query.access_tier as string | undefined) || undefined;
    const search = ((req.query.search as string | undefined) ?? '').trim() || undefined;
    const sort = ((req.query.sort as string | undefined) || 'created_at') as AssetSortField;
    const order = ((req.query.order as string | undefined) || 'desc') as SortOrder;

    // reject bad values up front; passed through, an unknown enum value would
    // surface as a database error instead of a clear 400
    if (status && !ASSET_STATUSES.includes(status)) {
      throw new AppError(400, `status must be one of: ${ASSET_STATUSES.join(', ')}`);
    }
    if (accessTier && accessTier !== 'public' && accessTier !== 'private') {
      throw new AppError(400, 'access_tier must be public or private');
    }
    if (!ASSET_SORT_FIELDS.includes(sort)) {
      throw new AppError(400, `sort must be one of: ${ASSET_SORT_FIELDS.join(', ')}`);
    }
    if (order !== 'asc' && order !== 'desc') {
      throw new AppError(400, 'order must be asc or desc');
    }
    if (search && search.length > 200) {
      throw new AppError(400, 'search must be at most 200 characters');
    }
    if (cursor && !isDefaultAssetOrder(sort, order)) {
      throw new AppError(400, 'cursor paging only supports the default order; use page instead');
    }

    const result = await deps.listAssets({
      page,
      limit,
      cursor,
      status,
      accessTier,
      search,
      sort,
      order,
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
      stage: processingStage(job.status, job.logs ?? []),
      progress_percent: job.progressPercent,
      retry_count: job.retryCount,
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

/**
 * The pipeline step a job is on. Workers tag every log line with their stage
 * (transcode, upload, finalize), so the latest line says where the job is;
 * terminal job states win over it.
 */
export function processingStage(
  status: string,
  logs: Array<{ stage: string }>,
): 'queued' | 'transcode' | 'upload' | 'finalize' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  const last = logs[logs.length - 1]?.stage;
  if (last === 'transcode' || last === 'upload' || last === 'finalize') return last;
  return 'queued';
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

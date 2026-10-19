import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import {
  ASSET_SORT_FIELDS,
  isDefaultAssetOrder,
  type AssetSortField,
  type SortOrder,
} from '../asset-sort.js';
import { decodeCursor } from '../pagination.js';
import {
  accessTierSchema,
  descriptionSchema,
  integerParam,
  parseOrThrow,
  stringParam,
  titleSchema,
} from '../validation.js';

const ASSET_STATUSES = ['created', 'uploading', 'processing', 'ready', 'failed'] as const;
const MAX_PAGE = 1_000_000;

// repeated parameters arrive as arrays and are refused; unknown ones are ignored
const listQuerySchema = z.object({
  page: integerParam('page', 1, MAX_PAGE).optional(),
  limit: integerParam('limit', 1, 100).optional(),
  cursor: stringParam('cursor').optional(),
  status: z
    .enum(ASSET_STATUSES, { message: `status must be one of: ${ASSET_STATUSES.join(', ')}` })
    .optional(),
  access_tier: accessTierSchema.optional(),
  search: stringParam('search')
    .max(200, { message: 'search must be at most 200 characters' })
    .optional(),
  sort: z
    .enum(ASSET_SORT_FIELDS, {
      message: `sort must be one of: ${ASSET_SORT_FIELDS.join(', ')}`,
    })
    .optional(),
  order: z.enum(['asc', 'desc'], { message: 'order must be asc or desc' }).optional(),
});

const patchBodySchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    access_tier: accessTierSchema.optional(),
  })
  .strict();

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
  /** Whether POST /retry can start a new run of this failed video. */
  retryable: boolean;
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
  // `owner` is the caller's creatorAddress (the workspace). Every by-id
  // operation is scoped by it, so a row with any other owner is never
  // reachable.
  getAsset: (id: string, owner?: string) => Promise<VideoAssetRecord | null>;
  /**
   * With `ifMatch`, the edit applies only while the asset is still at one of
   * those versions (see assetVersion); `conflict` carries the asset as it is.
   */
  updateAsset: (
    id: string,
    data: {
      title?: string;
      description?: string;
      accessTier?: 'public' | 'private';
    },
    owner?: string,
    ifMatch?: number[],
  ) => Promise<
    | { status: 'updated'; asset: VideoAssetRecord }
    | { status: 'not_found' }
    | { status: 'conflict'; current: VideoAssetRecord }
  >;
  deleteAsset: (id: string, owner?: string) => Promise<boolean>;
  getProcessingJob: (
    videoAssetId: string,
    owner?: string,
  ) => Promise<ProcessingJobRecord | undefined>;
  retryAsset: (id: string, owner?: string) => Promise<{ stage: string }>;
  /** The asset's renditions; null when the asset is not found or not owned. */
  getAssetRenditions: (
    id: string,
    owner?: string,
  ) => Promise<Array<{
    name: string;
    width: number | null;
    height: number | null;
    videoBitrateKbps: number | null;
    segmentCount: number;
    byteSize: number;
    dataObjectId: string;
    playlistObjectId: string;
  }> | null>;
}

interface VideoAssetRecord {
  id: string;
  title: string;
  description: string;
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  /** null until processing has measured it */
  durationMs: number | null;
  resolution: string | null;
  status: string;
  accessTier: string;
  creatorAddress: string;
  segmentCount: number;
  totalStorageBytes: number;
  /** All-time plays, see delivery/plays.ts. */
  playCount: number;
  lastPlayedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An asset's version: its updated_at in epoch milliseconds, which is also
 * what updated_at says to the millisecond, so a client can build the ETag
 * from any listing.
 */
export const assetVersion = (asset: { updatedAt: Date }) => asset.updatedAt.getTime();

const assetEtag = (asset: { updatedAt: Date }) => `"${assetVersion(asset)}"`;

/**
 * The versions an If-Match header accepts: undefined when there is no
 * condition (no header, or `*`), else the quoted versions it lists. A weak
 * tag counts as its strong twin: RFC 9110 has If-Match compare strongly, but
 * the only thing that weakens this ETag is a proxy compressing the body (the
 * bundled nginx gzips json), and the version it names is the same edit.
 */
export function parseIfMatch(header: string | undefined): number[] | undefined {
  if (header === undefined) return undefined;
  const tags = header
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.includes('*')) return undefined;
  const versions: number[] = [];
  for (const tag of tags) {
    const m = /^(?:W\/)?"(\d{1,15})"$/.exec(tag);
    if (!m) {
      throw new AppError(400, 'If-Match must be the ETag of the video, such as "1767225600000".');
    }
    versions.push(Number(m[1]));
  }
  return versions;
}

export function createAssetRoutes(deps: AssetRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/assets
   * List video assets with pagination and filtering.
   */
  router.get('/', requireScope('read'), async (req: Request, res: Response) => {
    const q = parseOrThrow(listQuerySchema, req.query);
    const sort = q.sort ?? 'created_at';
    const order = q.order ?? 'desc';
    const search = q.search?.trim() || undefined;

    if (q.cursor !== undefined && q.page !== undefined) {
      throw new AppError(400, 'Use either cursor or page, not both');
    }
    if (q.cursor !== undefined) {
      if (!isDefaultAssetOrder(sort, order)) {
        throw new AppError(400, 'cursor paging only supports the default order; use page instead');
      }
      // a corrupted cursor must not quietly start over at page one, or a
      // client paging forward would loop over the same rows
      if (!decodeCursor(q.cursor)) {
        throw new AppError(400, 'cursor is not valid; start again without it');
      }
    }

    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const result = await deps.listAssets({
      page,
      limit,
      cursor: q.cursor,
      status: q.status,
      accessTier: q.access_tier,
      search,
      sort,
      order,
      creatorAddress: ownerFilter(req.apiKey!.creatorAddress),
    });

    res.json({
      data: result.data.map(formatAsset),
      total: result.total,
      // a cursor page has no page number
      page: q.cursor !== undefined ? null : page,
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

    // the etag versions edits, for If-Match; a play changes the body without
    // it, so it must not validate a stored copy: no 304, and nothing to store
    delete req.headers['if-none-match'];
    res.set({ ETag: assetEtag(asset), 'Cache-Control': 'no-store' }).json(formatAsset(asset));
  });

  /**
   * PATCH /api/v1/assets/:id
   * Update video asset metadata. With If-Match (the ETag GET and PATCH send)
   * the edit applies only if nobody changed the asset since; otherwise 412
   * with the asset as it is now, so two tabs cannot overwrite each other.
   */
  router.patch('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const body = parseOrThrow(patchBodySchema, req.body ?? {});
    const ifMatch = parseIfMatch(req.get('If-Match'));

    const result = await deps.updateAsset(
      String(req.params.id),
      { title: body.title, description: body.description, accessTier: body.access_tier },
      ownerFilter(req.apiKey!.creatorAddress),
      ifMatch,
    );

    if (result.status === 'not_found') {
      throw new AppError(404, 'Video asset not found');
    }
    if (result.status === 'conflict') {
      res
        .status(412)
        .set('ETag', assetEtag(result.current))
        .json({
          error: 'This video was changed somewhere else.',
          current: formatAsset(result.current),
        });
      return;
    }

    res.set('ETag', assetEtag(result.asset)).json(formatAsset(result.asset));
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
      retryable: job.retryable,
    });
  });

  /**
   * GET /api/v1/assets/:id/renditions
   * The HLS renditions the pipeline produced, tallest first, with the Sia
   * objects holding each one's playlist and media.
   */
  router.get('/:id/renditions', requireScope('read'), async (req: Request, res: Response) => {
    const rows = await deps.getAssetRenditions(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
    if (!rows) {
      throw new AppError(404, 'Video asset not found');
    }
    res.json({
      data: rows.map((r) => ({
        name: r.name,
        width: r.width,
        height: r.height,
        video_bitrate_kbps: r.videoBitrateKbps,
        segment_count: r.segmentCount,
        byte_size: r.byteSize,
        data_object_id: r.dataObjectId,
        playlist_object_id: r.playlistObjectId,
      })),
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
    play_count: asset.playCount,
    last_played_at: asset.lastPlayedAt ? asset.lastPlayedAt.toISOString() : null,
    created_at: asset.createdAt.toISOString(),
    updated_at: asset.updatedAt.toISOString(),
  };
}

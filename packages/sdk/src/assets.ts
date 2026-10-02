// ---------------------------------------------------------------------------
// @sluby/sdk - AssetManager
// ---------------------------------------------------------------------------

import { TimeoutError } from './errors.js';
import type {
  AccessTier,
  ListAssetsOptions,
  PaginatedResponse,
  ProcessingJob,
  VideoAsset,
} from './types.js';
import type { FetchFn } from './uploads.js';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Manages CRUD operations and lifecycle polling for video assets.
 */
export class AssetManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/assets
  // -----------------------------------------------------------------------

  /**
   * List video assets with optional filtering and pagination.
   */
  async list(options?: ListAssetsOptions): Promise<PaginatedResponse<VideoAsset>> {
    const params = new URLSearchParams();
    if (options?.page != null) params.set('page', String(options.page));
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.status) params.set('status', options.status);
    if (options?.accessTier) params.set('access_tier', options.accessTier);
    if (options?.search) params.set('search', options.search);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.order) params.set('order', options.order);

    const query = params.toString();
    const path = `/api/v1/assets${query ? `?${query}` : ''}`;
    const res = await this._fetch(path);
    const body = await res.json();

    return {
      data: (body.data as Array<Record<string, unknown>>).map(mapAsset),
      total: body.total as number,
      page: body.page as number,
      limit: body.limit as number,
    };
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/assets/:id
  // -----------------------------------------------------------------------

  /**
   * Retrieve a single video asset by ID.
   */
  async get(videoAssetId: string): Promise<VideoAsset> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`);
    const body = await res.json();
    return mapAsset(body);
  }

  // -----------------------------------------------------------------------
  // PATCH /api/v1/assets/:id
  // -----------------------------------------------------------------------

  /**
   * Update mutable fields of a video asset.
   */
  async update(
    videoAssetId: string,
    data: Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>,
  ): Promise<VideoAsset> {
    const payload: Record<string, unknown> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description;
    if (data.accessTier !== undefined) payload.access_tier = data.accessTier;

    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    return mapAsset(body);
  }

  // -----------------------------------------------------------------------
  // DELETE /api/v1/assets/:id
  // -----------------------------------------------------------------------

  /**
   * Delete a video asset.
   */
  async delete(videoAssetId: string): Promise<void> {
    await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`, {
      method: 'DELETE',
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/assets/:id/processing
  // -----------------------------------------------------------------------

  /**
   * Processing progress for an asset: pipeline stage, percent, the error when
   * it failed, and the worker's log lines.
   */
  async processing(videoAssetId: string): Promise<ProcessingJob> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}/processing`);
    const raw = await res.json();
    return {
      id: raw.id,
      status: raw.status,
      stage: raw.stage,
      progressPercent: raw.progress_percent,
      retryCount: raw.retry_count ?? 0,
      errorMessage: raw.error_message ?? null,
      startedAt: raw.started_at ?? null,
      completedAt: raw.completed_at ?? null,
      createdAt: raw.created_at,
      logs: raw.logs ?? [],
    };
  }

  // -----------------------------------------------------------------------
  // POST /api/v1/assets/:id/retry
  // -----------------------------------------------------------------------

  /**
   * Re-run processing for a failed asset. The backend resumes from the
   * furthest step it can (e.g. skips the transcode when its output survived).
   * Returns the step it restarted from.
   */
  async retry(videoAssetId: string): Promise<{ stage: string }> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}/retry`, {
      method: 'POST',
    });
    const body = await res.json();
    return { stage: body.stage };
  }

  // -----------------------------------------------------------------------
  // Poll until ready
  // -----------------------------------------------------------------------

  /**
   * Poll the asset status until it reaches `ready` or the timeout elapses.
   *
   * If the asset transitions to `failed`, the promise is rejected
   * immediately with the current asset state.
   *
   * @param videoAssetId - Asset identifier.
   * @param options.pollInterval - Milliseconds between polls. Default 5 000.
   * @param options.timeout - Maximum wait in milliseconds. Default 600 000.
   * @returns The asset once its status is `ready`.
   */
  async waitForReady(
    videoAssetId: string,
    options?: { pollInterval?: number; timeout?: number },
  ): Promise<VideoAsset> {
    const interval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const asset = await this.get(videoAssetId);

      if (asset.status === 'ready') {
        return asset;
      }

      if (asset.status === 'failed') {
        throw new Error(`Video asset ${videoAssetId} entered "failed" status during processing.`);
      }

      // Wait before the next poll, but do not exceed the deadline.
      const remaining = deadline - Date.now();
      const delay = Math.min(interval, remaining);
      if (delay <= 0) break;

      await sleep(delay);
    }

    throw new TimeoutError(
      `Timed out after ${timeout}ms waiting for asset ${videoAssetId} to become ready.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a snake_case API response object to the camelCase `VideoAsset`
 * interface.
 */
function mapAsset(raw: Record<string, unknown>): VideoAsset {
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: raw.description as string,
    manifestObjectId: raw.manifest_object_id as string,
    thumbnailObjectIds: (raw.thumbnail_object_ids ?? []) as string[],
    durationMs: raw.duration_ms as number,
    resolution: raw.resolution as string,
    status: raw.status as VideoAsset['status'],
    accessTier: raw.access_tier as AccessTier,
    creatorAddress: raw.creator_address as string,
    segmentCount: raw.segment_count as number,
    totalStorageBytes: raw.total_storage_bytes as number,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

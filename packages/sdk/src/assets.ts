import {
  AbortError,
  ConflictError,
  ProcessingFailedError,
  TimeoutError,
  readJson,
} from './errors.js';
import type {
  AccessTier,
  AssetStats,
  ListAssetsOptions,
  PaginatedResponse,
  ProcessingJob,
  Rendition,
  RequestOptions,
  RetryStage,
  UsageReport,
  VideoAsset,
  VideoAssetStatus,
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

  /**
   * List video assets with optional filtering and pagination: by `page`, or
   * by passing each page's `nextCursor` back as `cursor`.
   */
  async list(options?: ListAssetsOptions): Promise<PaginatedResponse<VideoAsset>> {
    const params = new URLSearchParams();
    if (options?.page != null) params.set('page', String(options.page));
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.status) params.set('status', options.status);
    if (options?.accessTier) params.set('access_tier', options.accessTier);
    if (options?.search) params.set('search', options.search);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.order) params.set('order', options.order);

    const query = params.toString();
    const path = `/api/v1/assets${query ? `?${query}` : ''}`;
    const res = await this._fetch(path, { signal: options?.signal });
    const body = await readJson(res);

    return {
      data: (body.data as Array<Record<string, unknown>>).map(mapAsset),
      total: body.total as number,
      page: body.page as number,
      limit: body.limit as number,
      nextCursor: (body.next_cursor as string | null | undefined) ?? null,
      hasMore: body.has_more === true,
    };
  }

  /**
   * Retrieve a single video asset by ID.
   */
  async get(videoAssetId: string, options?: RequestOptions): Promise<VideoAsset> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`, {
      signal: options?.signal,
    });
    return mapAsset(await readJson(res));
  }

  /**
   * Update mutable fields of a video asset.
   *
   * Pass `ifMatch` (the asset as you read it, or its ETag) and the edit
   * applies only if nobody changed the asset since; otherwise it rejects with
   * a `ConflictError` (status 412) whose `current` is the asset as it is now,
   * so two editors never silently overwrite each other.
   */
  async update(
    videoAssetId: string,
    data: Partial<Pick<VideoAsset, 'title' | 'description' | 'accessTier'>>,
    options?: RequestOptions & { ifMatch?: VideoAsset | string },
  ): Promise<VideoAsset> {
    const payload: Record<string, unknown> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description;
    if (data.accessTier !== undefined) payload.access_tier = data.accessTier;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.ifMatch !== undefined) {
      headers['If-Match'] =
        typeof options.ifMatch === 'string' ? options.ifMatch : assetEtag(options.ifMatch);
    }
    let res: Response;
    try {
      res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
    } catch (err) {
      throw withCurrentAsset(err);
    }

    return mapAsset(await readJson(res));
  }

  /**
   * Plays of the workspace's videos per UTC day for the last `days` days (1 to
   * 90, default 30), today included. Needs the `read` scope.
   */
  async usage(options?: RequestOptions & { days?: number }): Promise<UsageReport> {
    const query = options?.days != null ? `?days=${encodeURIComponent(options.days)}` : '';
    const res = await this._fetch(`/api/v1/stats/usage${query}`, { signal: options?.signal });
    const raw = await readJson<{ days: Array<{ date: string; plays: number }>; total: number }>(
      res,
    );
    return {
      days: raw.days.map((d) => ({ date: d.date, plays: d.plays })),
      total: raw.total,
    };
  }

  /**
   * Delete a video asset.
   */
  async delete(videoAssetId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }

  /**
   * Processing progress for an asset: pipeline stage, percent, the error when
   * it failed, and the worker's log lines.
   */
  async processing(videoAssetId: string, options?: RequestOptions): Promise<ProcessingJob> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}/processing`, {
      signal: options?.signal,
    });
    const raw = await readJson<{
      id: string;
      status: ProcessingJob['status'];
      stage: ProcessingJob['stage'];
      progress_percent: number;
      retry_count?: number;
      error_message?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
      created_at: string;
      logs?: ProcessingJob['logs'] | null;
      retryable?: boolean;
    }>(res);
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
      retryable: raw.retryable === true,
    };
  }

  /**
   * The HLS renditions processing produced, tallest first, with the Sia
   * objects holding each one's playlist and media. Empty until the asset is
   * ready.
   */
  async renditions(videoAssetId: string, options?: RequestOptions): Promise<Rendition[]> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}/renditions`, {
      signal: options?.signal,
    });
    const body = await readJson(res);
    return (body.data as Array<Record<string, unknown>>).map((raw) => ({
      name: raw.name as string,
      width: (raw.width as number | null | undefined) ?? null,
      height: (raw.height as number | null | undefined) ?? null,
      videoBitrateKbps: (raw.video_bitrate_kbps as number | null | undefined) ?? null,
      segmentCount: raw.segment_count as number,
      byteSize: raw.byte_size as number,
      dataObjectId: raw.data_object_id as string,
      playlistObjectId: raw.playlist_object_id as string,
    }));
  }

  /**
   * Library totals for the workspace: asset counts by status, bytes
   * stored on Sia, ready playtime and the number of Sia objects. Deleted
   * assets are not counted.
   */
  async stats(options?: RequestOptions): Promise<AssetStats> {
    const res = await this._fetch('/api/v1/stats', { signal: options?.signal });
    const raw = await readJson<{
      total: number;
      by_status: Partial<Record<VideoAssetStatus, number>>;
      stored_bytes: number;
      ready_duration_ms: number;
      object_count: number;
    }>(res);
    return {
      total: raw.total,
      byStatus: {
        created: raw.by_status.created ?? 0,
        uploading: raw.by_status.uploading ?? 0,
        processing: raw.by_status.processing ?? 0,
        ready: raw.by_status.ready ?? 0,
        failed: raw.by_status.failed ?? 0,
      },
      storedBytes: raw.stored_bytes,
      readyDurationMs: raw.ready_duration_ms,
      objectCount: raw.object_count,
    };
  }

  /**
   * Re-run processing for a failed asset. The backend resumes from the
   * furthest step it can (e.g. skips the transcode when its output survived).
   * Returns the step it restarted from.
   */
  async retry(videoAssetId: string, options?: RequestOptions): Promise<{ stage: RetryStage }> {
    const res = await this._fetch(`/api/v1/assets/${encodeURIComponent(videoAssetId)}/retry`, {
      method: 'POST',
      signal: options?.signal,
    });
    const body = await readJson(res);
    return { stage: body.stage as RetryStage };
  }

  /**
   * Poll the asset status until it reaches `ready` or the timeout elapses.
   * The asset is always read at least once, even with `timeout: 0`.
   *
   * Rejects with a `ProcessingFailedError` carrying the asset as soon as it is
   * `failed`, with a `TimeoutError` when the timeout elapses first, and with
   * an `AbortError` when `signal` fires (which also stops the polling).
   *
   * @param videoAssetId - Asset identifier.
   * @param options.pollInterval - Milliseconds between polls. Default 5 000.
   * @param options.timeout - Maximum wait in milliseconds. Default 600 000.
   * @param options.signal - Stops polling and rejects when it fires.
   * @returns The asset once its status is `ready`.
   */
  async waitForReady(
    videoAssetId: string,
    options?: { pollInterval?: number; timeout?: number; signal?: AbortSignal },
  ): Promise<VideoAsset> {
    const interval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const signal = options?.signal;

    const deadline = Date.now() + timeout;

    for (;;) {
      const asset = await this.get(videoAssetId, { signal });

      if (asset.status === 'ready') {
        return asset;
      }

      if (asset.status === 'failed') {
        throw new ProcessingFailedError(asset);
      }

      // Wait before the next poll, but do not exceed the deadline.
      const delay = Math.min(interval, deadline - Date.now());
      if (delay <= 0) break;

      await sleep(delay, signal);
    }

    throw new TimeoutError(
      `Timed out after ${timeout}ms waiting for asset ${videoAssetId} to become ready.`,
    );
  }
}

/**
 * Map a snake_case API response object to the camelCase `VideoAsset`
 * interface.
 */
function mapAsset(raw: Record<string, unknown>): VideoAsset {
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: raw.description as string,
    manifestObjectId: (raw.manifest_object_id as string | null | undefined) ?? null,
    thumbnailObjectIds: (raw.thumbnail_object_ids ?? []) as string[],
    durationMs: (raw.duration_ms as number | null | undefined) ?? null,
    resolution: (raw.resolution as string | null | undefined) ?? null,
    status: raw.status as VideoAsset['status'],
    accessTier: raw.access_tier as AccessTier,
    creatorAddress: raw.creator_address as string,
    segmentCount: raw.segment_count as number,
    totalStorageBytes: raw.total_storage_bytes as number,
    playCount: (raw.play_count as number | undefined) ?? 0,
    lastPlayedAt: (raw.last_played_at as string | null | undefined) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

/**
 * The ETag of an asset as read: its `updatedAt` in milliseconds since the
 * epoch, quoted, which is how the server versions an asset.
 */
export function assetEtag(asset: Pick<VideoAsset, 'updatedAt'>): string {
  const ms = Date.parse(asset.updatedAt);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`assetEtag: updatedAt is not a date (${String(asset.updatedAt)})`);
  }
  return `"${ms}"`;
}

// a 412 carries the asset as it is now; hand it to the caller mapped
function withCurrentAsset(err: unknown): unknown {
  if (!(err instanceof ConflictError) || err.statusCode !== 412 || !err.responseBody) return err;
  try {
    const body = JSON.parse(err.responseBody) as { current?: Record<string, unknown> };
    if (!body.current) return err;
    return new ConflictError(err.message, err.responseBody, 412, mapAsset(body.current));
  } catch {
    return err;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError('Stopped waiting: the signal was aborted.', { cause: signal.reason }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError('Stopped waiting: the signal was aborted.', { cause: signal?.reason }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

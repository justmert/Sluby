import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetManager } from './assets.js';
import {
  AbortError,
  ConflictError,
  ProcessingFailedError,
  SlubyError,
  TimeoutError,
  errorFromStatus,
} from './errors.js';
import { assetEtag } from './assets.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

const SAMPLE_RAW_ASSET = {
  id: 'asset_1',
  title: 'Test Video',
  description: 'A test',
  manifest_object_id: 'obj_1',
  thumbnail_object_ids: ['thumb_1', 'thumb_2'],
  duration_ms: 120000,
  resolution: '1920x1080',
  status: 'ready',
  access_tier: 'public',
  creator_address: '0xcreator',
  segment_count: 24,
  total_storage_bytes: 50000000,
  play_count: 12,
  last_played_at: '2025-01-03T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
};

const EXPECTED_MAPPED_ASSET = {
  id: 'asset_1',
  title: 'Test Video',
  description: 'A test',
  manifestObjectId: 'obj_1',
  thumbnailObjectIds: ['thumb_1', 'thumb_2'],
  durationMs: 120000,
  resolution: '1920x1080',
  status: 'ready',
  accessTier: 'public',
  creatorAddress: '0xcreator',
  segmentCount: 24,
  totalStorageBytes: 50000000,
  playCount: 12,
  lastPlayedAt: '2025-01-03T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
};

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('AssetManager.list()', () => {
  it('should GET /api/v1/assets without query params when no options provided', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        data: [SAMPLE_RAW_ASSET],
        total: 1,
        page: 1,
        limit: 20,
      }),
    );

    const manager = new AssetManager(mockFetch);
    const result = await manager.list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets', { signal: undefined });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(EXPECTED_MAPPED_ASSET);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('should add query params for page and limit', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 2, limit: 10 }));

    const manager = new AssetManager(mockFetch);
    await manager.list({ page: 2, limit: 10 });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('limit=10');
  });

  it('should add status query param', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 1, limit: 20 }));

    const manager = new AssetManager(mockFetch);
    await manager.list({ status: 'processing' });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toContain('status=processing');
  });

  it('should map accessTier to access_tier query param', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 1, limit: 20 }));

    const manager = new AssetManager(mockFetch);
    await manager.list({ accessTier: 'private' });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toContain('access_tier=private');
  });

  it('should combine multiple query params', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 3, limit: 5 }));

    const manager = new AssetManager(mockFetch);
    await manager.list({ page: 3, limit: 5, status: 'ready', accessTier: 'public' });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toContain('page=3');
    expect(calledPath).toContain('limit=5');
    expect(calledPath).toContain('status=ready');
    expect(calledPath).toContain('access_tier=public');
  });

  it('sends search and sort options', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 1, limit: 20 }));

    await new AssetManager(mockFetch).list({ search: 'big buck', sort: 'title', order: 'asc' });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/assets?search=big+buck&sort=title&order=asc');
  });

  it('pages by cursor: sends cursor and returns nextCursor and hasMore', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeJsonResponse({
          data: [SAMPLE_RAW_ASSET],
          total: 2,
          page: 1,
          limit: 1,
          next_cursor: 'c2',
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          data: [SAMPLE_RAW_ASSET],
          total: 2,
          page: 1,
          limit: 1,
          next_cursor: null,
          has_more: false,
        }),
      );
    const manager = new AssetManager(mockFetch);

    const first = await manager.list({ limit: 1 });
    expect(first.nextCursor).toBe('c2');
    expect(first.hasMore).toBe(true);

    const second = await manager.list({ limit: 1, cursor: first.nextCursor! });
    expect(mockFetch.mock.calls[1][0]).toBe('/api/v1/assets?limit=1&cursor=c2');
    expect(second.nextCursor).toBeNull();
    expect(second.hasMore).toBe(false);
  });

  it('passes the caller signal to the request', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [], total: 0, page: 1, limit: 20 }));
    const controller = new AbortController();

    await new AssetManager(mockFetch).list({ signal: controller.signal });

    expect(mockFetch.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});

describe('AssetManager.get()', () => {
  it('should GET /api/v1/assets/:id and map the response', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    const result = await manager.get('asset_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset_1', { signal: undefined });
    expect(result).toEqual(EXPECTED_MAPPED_ASSET);
  });

  it('should encode the asset ID in the path', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    await manager.get('asset/with/slashes');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset%2Fwith%2Fslashes', {
      signal: undefined,
    });
  });

  it('should handle missing thumbnail_object_ids (defaults to empty array)', async () => {
    const rawWithoutThumbnails = { ...SAMPLE_RAW_ASSET, thumbnail_object_ids: undefined };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(rawWithoutThumbnails));

    const manager = new AssetManager(mockFetch);
    const result = await manager.get('asset_1');

    expect(result.thumbnailObjectIds).toEqual([]);
  });
});

describe('AssetManager.update()', () => {
  it('should PATCH /api/v1/assets/:id with camelCase to snake_case mapping', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ...SAMPLE_RAW_ASSET, title: 'Updated Title' }),
    );

    const manager = new AssetManager(mockFetch);
    await manager.update('asset_1', {
      title: 'Updated Title',
      accessTier: 'private',
    });

    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/v1/assets/asset_1');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      title: 'Updated Title',
      access_tier: 'private',
    });
  });

  it('should only include defined fields in the payload', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    await manager.update('asset_1', { title: 'New Title' });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ title: 'New Title' });
    expect(body.access_tier).toBeUndefined();
    expect(body.description).toBeUndefined();
  });

  it('should include description when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    await manager.update('asset_1', { description: 'New description' });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ description: 'New description' });
  });

  it('should set Content-Type header', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    await manager.update('asset_1', { title: 'T' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('AssetManager.delete()', () => {
  it('should DELETE /api/v1/assets/:id', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

    const manager = new AssetManager(mockFetch);
    await manager.delete('asset_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset_1', {
      method: 'DELETE',
    });
  });
});

describe('AssetManager.processing()', () => {
  it('maps the processing job to camelCase', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'job_1',
        status: 'failed',
        stage: 'failed',
        progress_percent: 65,
        retry_count: 3,
        error_message: 'ffmpeg exited with code 1',
        started_at: '2025-01-01T00:00:00Z',
        completed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        logs: [{ timestamp: 't', stage: 'transcode', message: 'Starting transcode' }],
        retryable: false,
      }),
    );

    const job = await new AssetManager(mockFetch).processing('asset_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset_1/processing', {
      signal: undefined,
    });
    expect(job).toEqual({
      id: 'job_1',
      status: 'failed',
      stage: 'failed',
      progressPercent: 65,
      retryCount: 3,
      errorMessage: 'ffmpeg exited with code 1',
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: null,
      createdAt: '2025-01-01T00:00:00Z',
      logs: [{ timestamp: 't', stage: 'transcode', message: 'Starting transcode' }],
      retryable: false,
    });
  });
});

describe('AssetManager.retry()', () => {
  it('POSTs to /retry and returns the restart stage', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, stage: 'upload' }));

    const result = await new AssetManager(mockFetch).retry('asset_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset_1/retry', {
      method: 'POST',
      signal: undefined,
    });
    expect(result).toEqual({ stage: 'upload' });
  });
});

describe('AssetManager.waitForReady()', () => {
  it('should return immediately if asset is already ready', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const manager = new AssetManager(mockFetch);
    const result = await manager.waitForReady('asset_1', { pollInterval: 100, timeout: 1000 });

    expect(result.status).toBe('ready');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects with a ProcessingFailedError carrying the asset when it fails', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'failed' }));

    const manager = new AssetManager(mockFetch);

    const err = await manager
      .waitForReady('asset_1', { pollInterval: 100, timeout: 1000 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProcessingFailedError);
    expect(err).toBeInstanceOf(SlubyError);
    expect((err as ProcessingFailedError).asset).toMatchObject({ id: 'asset_1', status: 'failed' });
  });

  it('should poll and return when asset becomes ready', async () => {
    // First call: processing, second call: ready
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'processing' }))
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const manager = new AssetManager(mockFetch);
    // Use a very short interval so the real timer fires quickly
    const result = await manager.waitForReady('asset_1', { pollInterval: 10, timeout: 5000 });

    expect(result.status).toBe('ready');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should throw TimeoutError when timeout elapses', async () => {
    // Always return processing
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'processing' })),
    );

    const manager = new AssetManager(mockFetch);

    // Use very short intervals so the test completes quickly with real timers
    await expect(manager.waitForReady('asset_1', { pollInterval: 5, timeout: 50 })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should include timeout duration in error message', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'processing' })),
    );

    const manager = new AssetManager(mockFetch);

    await expect(manager.waitForReady('asset_1', { pollInterval: 5, timeout: 50 })).rejects.toThrow(
      'Timed out after 50ms',
    );
  });

  it('should use default pollInterval and timeout when not specified', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const manager = new AssetManager(mockFetch);
    const result = await manager.waitForReady('asset_1');

    expect(result.status).toBe('ready');
  });

  it('should poll multiple times before returning ready', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'created' }))
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'uploading' }))
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'processing' }))
      .mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const manager = new AssetManager(mockFetch);
    const result = await manager.waitForReady('asset_1', { pollInterval: 5, timeout: 5000 });

    expect(result.status).toBe('ready');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('reads the asset once even with timeout 0', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const result = await new AssetManager(mockFetch).waitForReady('asset_1', { timeout: 0 });

    expect(result.status).toBe('ready');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stops polling and rejects with AbortError when the signal fires', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'processing' })),
    );
    const controller = new AbortController();

    const waiting = new AssetManager(mockFetch).waitForReady('asset_1', {
      pollInterval: 10_000,
      timeout: 60_000,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort('unmounted');

    const err = await waiting.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbortError);
    expect((err as AbortError).name).toBe('AbortError');
    expect((err as AbortError).cause).toBe('unmounted');
    // one read, then the sleep was cut short instead of polling on
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});

describe('asset mapping', () => {
  it('keeps a null duration and resolution as null', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ...SAMPLE_RAW_ASSET, duration_ms: null, resolution: null }),
    );

    const asset = await new AssetManager(mockFetch).get('asset_1');

    expect(asset.durationMs).toBeNull();
    expect(asset.resolution).toBeNull();
  });
});

describe('AssetManager.renditions()', () => {
  it("gets the asset's renditions and maps them", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        data: [
          {
            name: '720p',
            width: 1280,
            height: 720,
            video_bitrate_kbps: 2800,
            segment_count: 4,
            byte_size: 1234,
            data_object_id: 'data_1',
            playlist_object_id: 'pl_1',
          },
        ],
      }),
    );

    const rows = await new AssetManager(mockFetch).renditions('asset/1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset%2F1/renditions', {
      signal: undefined,
    });
    expect(rows).toEqual([
      {
        name: '720p',
        width: 1280,
        height: 720,
        videoBitrateKbps: 2800,
        segmentCount: 4,
        byteSize: 1234,
        dataObjectId: 'data_1',
        playlistObjectId: 'pl_1',
      },
    ]);
  });
});

describe('AssetManager.stats()', () => {
  it('gets the library totals and maps them, filling statuses the server left out', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        total: 3,
        by_status: { ready: 2, failed: 1 },
        stored_bytes: 900,
        ready_duration_ms: 60000,
        object_count: 12,
      }),
    );

    const stats = await new AssetManager(mockFetch).stats();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/stats', { signal: undefined });
    expect(stats).toEqual({
      total: 3,
      byStatus: { created: 0, uploading: 0, processing: 0, ready: 2, failed: 1 },
      storedBytes: 900,
      readyDurationMs: 60000,
      objectCount: 12,
    });
  });
});

describe('AssetManager.update() with ifMatch', () => {
  it('sends the version of an asset as read as If-Match', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    await new AssetManager(mockFetch).update(
      'asset_1',
      { title: 'New' },
      { ifMatch: EXPECTED_MAPPED_ASSET as never },
    );

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-Match']).toBe(
      `"${Date.parse('2025-01-02T00:00:00Z')}"`,
    );
  });

  it('sends an ETag string as it is, and no If-Match without one', async () => {
    mockFetch.mockResolvedValue(makeJsonResponse(SAMPLE_RAW_ASSET));
    const assets = new AssetManager(mockFetch);
    await assets.update('asset_1', { title: 'a' }, { ifMatch: '"123"' });
    await assets.update('asset_1', { title: 'b' });
    const headers = mockFetch.mock.calls.map(
      (c) => (c[1] as RequestInit).headers as Record<string, string>,
    );
    expect(headers[0]['If-Match']).toBe('"123"');
    expect(headers[1]['If-Match']).toBeUndefined();
  });

  it('rejects a 412 with a ConflictError carrying the asset as it is now', async () => {
    const body = JSON.stringify({
      error: 'This video was changed somewhere else.',
      current: { ...SAMPLE_RAW_ASSET, title: 'Theirs' },
    });
    mockFetch.mockRejectedValueOnce(
      errorFromStatus(412, 'This video was changed somewhere else.', body),
    );

    const err = await new AssetManager(mockFetch)
      .update('asset_1', { title: 'Mine' }, { ifMatch: '"1"' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).statusCode).toBe(412);
    expect((err as ConflictError).current).toEqual({ ...EXPECTED_MAPPED_ASSET, title: 'Theirs' });
  });

  it('builds the ETag from updatedAt, and refuses one that is not a date', () => {
    expect(assetEtag({ updatedAt: '2026-01-01T00:00:00.000Z' })).toBe('"1767225600000"');
    expect(() => assetEtag({ updatedAt: 'soon' })).toThrow(TypeError);
  });
});

describe('AssetManager.usage()', () => {
  it('gets plays per day and maps them', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ days: [{ date: '2026-10-09', plays: 3 }], total: 3 }),
    );
    const usage = await new AssetManager(mockFetch).usage({ days: 1 });
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/stats/usage?days=1', { signal: undefined });
    expect(usage).toEqual({ days: [{ date: '2026-10-09', plays: 3 }], total: 3 });
  });

  it('asks for the server default without days', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ days: [], total: 0 }));
    await new AssetManager(mockFetch).usage();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/stats/usage');
  });
});

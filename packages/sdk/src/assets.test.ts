import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetManager } from './assets.js';
import { TimeoutError } from './errors.js';
import type { FetchFn } from './uploads.js';

// ---------------------------------------------------------------------------
// Mock fetch function
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: list()
// ---------------------------------------------------------------------------

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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets');
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
});

// ---------------------------------------------------------------------------
// Tests: get()
// ---------------------------------------------------------------------------

describe('AssetManager.get()', () => {
  it('should GET /api/v1/assets/:id and map the response', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    const result = await manager.get('asset_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset_1');
    expect(result).toEqual(EXPECTED_MAPPED_ASSET);
  });

  it('should encode the asset ID in the path', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(SAMPLE_RAW_ASSET));

    const manager = new AssetManager(mockFetch);
    await manager.get('asset/with/slashes');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/asset%2Fwith%2Fslashes');
  });

  it('should handle missing thumbnail_object_ids (defaults to empty array)', async () => {
    const rawWithoutThumbnails = { ...SAMPLE_RAW_ASSET, thumbnail_object_ids: undefined };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(rawWithoutThumbnails));

    const manager = new AssetManager(mockFetch);
    const result = await manager.get('asset_1');

    expect(result.thumbnailObjectIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: update()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: delete()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: waitForReady()
// ---------------------------------------------------------------------------

describe('AssetManager.waitForReady()', () => {
  it('should return immediately if asset is already ready', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'ready' }));

    const manager = new AssetManager(mockFetch);
    const result = await manager.waitForReady('asset_1', { pollInterval: 100, timeout: 1000 });

    expect(result.status).toBe('ready');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should throw Error when asset enters failed status', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...SAMPLE_RAW_ASSET, status: 'failed' }));

    const manager = new AssetManager(mockFetch);

    await expect(
      manager.waitForReady('asset_1', { pollInterval: 100, timeout: 1000 }),
    ).rejects.toThrow('Video asset asset_1 entered "failed" status during processing.');
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
});

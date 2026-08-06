import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createAssetRoutes, type AssetRouteDeps } from '../api/routes/assets.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const defaultApiKey = {
  id: 'key-1',
  name: 'Test Key',
  scopes: ['read', 'upload', 'manage'],
  rateLimit: 100,
  creatorAddress: '0xabc123',
};

function createMockAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    title: 'Test Video',
    description: 'A test video',
    manifestObjectId: 'manifest-obj-1',
    thumbnailObjectIds: ['thumb-1', 'thumb-2'],
    durationMs: 120000,
    resolution: '1920x1080',
    status: 'ready',
    accessTier: 'public',
    creatorAddress: '0xabc123',
    segmentCount: 20,
    totalStorageBytes: 50_000_000,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T01:00:00Z'),
    ...overrides,
  };
}

describe('asset routes', () => {
  let deps: AssetRouteDeps;

  beforeEach(() => {
    deps = {
      listAssets: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getAsset: vi.fn().mockResolvedValue(null),
      updateAsset: vi.fn().mockResolvedValue(null),
      deleteAsset: vi.fn().mockResolvedValue(true),
      getProcessingJob: vi.fn().mockResolvedValue(undefined),
      retryAsset: vi.fn().mockResolvedValue({ stage: 'upload-segments' }),
    };
  });

  function createApp() {
    const router = createAssetRoutes(deps);
    const app = createTestApp(router);
    return withApiKey(app, defaultApiKey);
  }

  describe('GET /', () => {
    it('should return a list of assets with pagination', async () => {
      const mockAsset = createMockAsset();
      vi.mocked(deps.listAssets).mockResolvedValue({ data: [mockAsset], total: 1 });

      const res = await request(createApp()).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });

    it('should pass query parameters to listAssets', async () => {
      vi.mocked(deps.listAssets).mockResolvedValue({ data: [], total: 0 });

      await request(createApp()).get('/?page=2&limit=10&status=ready&access_tier=public');

      expect(deps.listAssets).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        status: 'ready',
        accessTier: 'public',
        creatorAddress: '0xabc123',
      });
    });

    it('should clamp page to minimum 1', async () => {
      await request(createApp()).get('/?page=-5');

      expect(deps.listAssets).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    });

    it('should clamp limit between 1 and 100', async () => {
      await request(createApp()).get('/?limit=200');

      expect(deps.listAssets).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('should format asset fields as snake_case in response', async () => {
      vi.mocked(deps.listAssets).mockResolvedValue({
        data: [createMockAsset()],
        total: 1,
      });

      const res = await request(createApp()).get('/');

      const asset = res.body.data[0];
      expect(asset).toHaveProperty('manifest_object_id');
      expect(asset).toHaveProperty('thumbnail_object_ids');
      expect(asset).toHaveProperty('duration_ms');
      expect(asset).toHaveProperty('access_tier');
      expect(asset).toHaveProperty('creator_address');
      expect(asset).toHaveProperty('segment_count');
      expect(asset).toHaveProperty('total_storage_bytes');
      expect(asset).toHaveProperty('created_at');
      expect(asset).toHaveProperty('updated_at');
    });

    it('should return 403 without read scope', async () => {
      const router = createAssetRoutes(deps);
      const app = createTestApp(router);
      const noScopeApp = withApiKey(app, { ...defaultApiKey, scopes: ['upload'] });

      const res = await request(noScopeApp).get('/');

      expect(res.status).toBe(403);
    });

    it('should pass the cursor query param through to listAssets', async () => {
      vi.mocked(deps.listAssets).mockResolvedValue({ data: [], total: 0 });

      await request(createApp()).get('/?cursor=abc123&limit=10');

      expect(deps.listAssets).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: 'abc123', limit: 10 }),
      );
    });

    it('should surface next_cursor and has_more from the dep result', async () => {
      vi.mocked(deps.listAssets).mockResolvedValue({
        data: [createMockAsset()],
        total: 5,
        nextCursor: 'next-token',
        hasMore: true,
      });

      const res = await request(createApp()).get('/?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.next_cursor).toBe('next-token');
      expect(res.body.has_more).toBe(true);
    });

    it('should default has_more to false and next_cursor to null when absent', async () => {
      vi.mocked(deps.listAssets).mockResolvedValue({ data: [], total: 0 });

      const res = await request(createApp()).get('/');

      expect(res.body.has_more).toBe(false);
      expect(res.body.next_cursor).toBeNull();
    });
  });

  describe('GET /:id', () => {
    it('should return a single asset', async () => {
      vi.mocked(deps.getAsset).mockResolvedValue(createMockAsset());

      const res = await request(createApp()).get('/asset-1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('asset-1');
      expect(res.body.title).toBe('Test Video');
    });

    it('should return 404 when asset not found', async () => {
      vi.mocked(deps.getAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video asset not found');
    });

    it("should scope the lookup to the caller's creator address", async () => {
      vi.mocked(deps.getAsset).mockResolvedValue(createMockAsset());

      await request(createApp()).get('/asset-1');

      expect(deps.getAsset).toHaveBeenCalledWith('asset-1', '0xabc123');
    });

    it('should not scope the lookup for a platform (all-zero address) key', async () => {
      vi.mocked(deps.getAsset).mockResolvedValue(createMockAsset());
      const platform = { ...defaultApiKey, creatorAddress: `0x${'0'.repeat(64)}` };
      const app = withApiKey(createTestApp(createAssetRoutes(deps)), platform);

      await request(app).get('/asset-1');

      // undefined owner => cross-tenant access, reserved for the platform key.
      expect(deps.getAsset).toHaveBeenCalledWith('asset-1', undefined);
    });

    it("should hide another tenant's asset behind a 404", async () => {
      // Owner-scoped lookup finds nothing because the asset belongs elsewhere.
      vi.mocked(deps.getAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/someone-elses-asset');

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /:id', () => {
    it('should update asset metadata', async () => {
      const updated = createMockAsset({ title: 'Updated Title' });
      vi.mocked(deps.updateAsset).mockResolvedValue(updated);

      const res = await request(createApp())
        .patch('/asset-1')
        .send({ title: 'Updated Title', description: 'New desc' });

      expect(res.status).toBe(200);
      // Third argument is the owner scope, derived from the caller's key.
      expect(deps.updateAsset).toHaveBeenCalledWith(
        'asset-1',
        { title: 'Updated Title', description: 'New desc', accessTier: undefined },
        '0xabc123',
      );
    });

    it('should return 404 when asset not found', async () => {
      vi.mocked(deps.updateAsset).mockResolvedValue(null);

      const res = await request(createApp()).patch('/nonexistent').send({ title: 'New' });

      expect(res.status).toBe(404);
    });

    it('should require manage scope', async () => {
      const router = createAssetRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp).patch('/asset-1').send({ title: 'New' });

      expect(res.status).toBe(403);
    });

    it('should map access_tier to accessTier in dep call', async () => {
      vi.mocked(deps.updateAsset).mockResolvedValue(createMockAsset());

      await request(createApp()).patch('/asset-1').send({ access_tier: 'private' });

      expect(deps.updateAsset).toHaveBeenCalledWith(
        'asset-1',
        expect.objectContaining({ accessTier: 'private' }),
        '0xabc123',
      );
    });
  });

  describe('DELETE /:id', () => {
    it('should delete an asset and return success', async () => {
      const res = await request(createApp()).delete('/asset-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(deps.deleteAsset).toHaveBeenCalledWith('asset-1', '0xabc123');
    });

    it('should return 404 when the asset is not owned by the caller', async () => {
      // The owner-scoped delete matched no row (someone else's asset).
      vi.mocked(deps.deleteAsset).mockResolvedValue(false);

      const res = await request(createApp()).delete('/asset-1');

      expect(res.status).toBe(404);
    });

    it('should require manage scope', async () => {
      const router = createAssetRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp).delete('/asset-1');

      expect(res.status).toBe(403);
    });
  });
});

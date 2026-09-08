import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createPlaybackRoutes, type PlaybackRouteDeps } from '../api/routes/playback.js';
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

describe('playback routes', () => {
  let deps: PlaybackRouteDeps;

  beforeEach(() => {
    deps = {
      getPlaybackAsset: vi.fn().mockResolvedValue(null),
      generateSignedUrl: vi.fn().mockResolvedValue({
        signedUrl: 'https://signed.url/manifest',
        expiresAt: '2025-06-01T00:00:00Z',
      }),
      createShareUrls: vi.fn().mockResolvedValue({
        masterObjectId: 'manifest-obj-1',
        shares: { 'manifest-obj-1': 'sia://ref#key', 'data-obj-1': 'sia://ref2#key2' },
        expiresAt: '2025-06-01T01:00:00Z',
      }),
      resolveObjectTier: vi.fn().mockResolvedValue('public'),
    };
  });

  function createApp() {
    const router = createPlaybackRoutes(deps);
    const app = createTestApp(router);
    return withApiKey(app, defaultApiKey);
  }

  describe('GET /:id', () => {
    it('should return playback info for a ready asset', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: ['thumb-1'],
        durationMs: 120000,
        resolution: '1920x1080',
        accessTier: 'public',
        status: 'ready',
      });

      const res = await request(createApp()).get('/asset-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        playback_url: '/v1/objects/manifest-obj-1?type=manifest',
        poster_url: '/v1/objects/thumb-1',
        duration_ms: 120000,
        resolution: '1920x1080',
        access_tier: 'public',
      });
    });

    it('should return null poster_url when no thumbnails', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'public',
        status: 'ready',
      });

      const res = await request(createApp()).get('/asset-1');

      expect(res.status).toBe(200);
      expect(res.body.poster_url).toBeNull();
    });

    it('should return 404 when asset not found', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video asset not found');
    });

    it('should return 409 when video is not ready', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: null,
        thumbnailObjectIds: [],
        durationMs: 0,
        resolution: '',
        accessTier: 'public',
        status: 'processing',
      });

      const res = await request(createApp()).get('/asset-1');

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('not ready');
    });

    it('should return 409 when manifest object ID is missing', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: null,
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'public',
        status: 'ready',
      });

      const res = await request(createApp()).get('/asset-1');

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Video manifest not available');
    });

    it('should require read scope', async () => {
      const router = createPlaybackRoutes(deps);
      const app = createTestApp(router);
      const noReadApp = withApiKey(app, { ...defaultApiKey, scopes: ['upload'] });

      const res = await request(noReadApp).get('/asset-1');

      expect(res.status).toBe(403);
    });

    it('scopes the lookup to the calling tenant', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 1,
        resolution: '1280x720',
        accessTier: 'public',
        status: 'ready',
      });

      await request(createApp()).get('/asset-1');

      // The owner (the caller's creatorAddress) must reach the lookup so a
      // caller cannot read another tenant's asset by guessing its id.
      expect(deps.getPlaybackAsset).toHaveBeenCalledWith('asset-1', '0xabc123');
    });
  });

  describe('GET /:id/signed', () => {
    it('should return a signed playback URL', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
      });

      const res = await request(createApp()).get('/asset-1/signed');

      expect(res.status).toBe(200);
      // Wire format is snake_case, matching every other endpoint and what the
      // SDK reads. Returning camelCase here left the SDK with undefined fields.
      expect(res.body).toEqual({
        signed_url: 'https://signed.url/manifest',
        expires_at: '2025-06-01T00:00:00Z',
      });
    });

    it('should pass default expiresIn of 3600', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
      });

      await request(createApp()).get('/asset-1/signed');

      expect(deps.generateSignedUrl).toHaveBeenCalledWith('manifest-obj-1', 3600);
    });

    it('scopes the signed lookup to the calling tenant', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 1,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
      });

      await request(createApp()).get('/asset-1/signed');

      expect(deps.getPlaybackAsset).toHaveBeenCalledWith('asset-1', '0xabc123');
    });

    it('should accept custom expires_in query parameter', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
      });

      await request(createApp()).get('/asset-1/signed?expires_in=7200');

      expect(deps.generateSignedUrl).toHaveBeenCalledWith('manifest-obj-1', 7200);
    });

    it('should return 404 when asset not found', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/asset-1/signed');

      expect(res.status).toBe(404);
    });

    it('should return 409 when video is not ready', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: null,
        thumbnailObjectIds: [],
        durationMs: 0,
        resolution: '',
        accessTier: 'public',
        status: 'processing',
      });

      const res = await request(createApp()).get('/asset-1/signed');

      expect(res.status).toBe(409);
    });
  });

  describe('GET /:id/share', () => {
    const readyAsset = {
      id: 'asset-1',
      manifestObjectId: 'manifest-obj-1',
      thumbnailObjectIds: [],
      durationMs: 60000,
      resolution: '1280x720',
      accessTier: 'public' as const,
      status: 'ready',
    };

    it('returns the share-url map with master + expiry', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        master_object_id: 'manifest-obj-1',
        shares: { 'manifest-obj-1': 'sia://ref#key', 'data-obj-1': 'sia://ref2#key2' },
        expires_at: '2025-06-01T01:00:00Z',
      });
    });

    it('mints against the resolved asset id and the default hour', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      await request(createApp()).get('/asset-1/share');

      expect(deps.createShareUrls).toHaveBeenCalledWith('asset-1', 'manifest-obj-1', 3600);
    });

    it('clamps a public request to the six-hour ceiling', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      await request(createApp()).get('/asset-1/share?expires_in=999999');

      expect(deps.createShareUrls).toHaveBeenCalledWith('asset-1', 'manifest-obj-1', 21600);
    });

    it('caps a private asset to one hour and marks the response no-store', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        ...readyAsset,
        accessTier: 'private',
      });

      const res = await request(createApp()).get('/asset-1/share?expires_in=999999');

      expect(deps.createShareUrls).toHaveBeenCalledWith('asset-1', 'manifest-obj-1', 3600);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('caps + no-stores a public asset that has a signed-policy playback id', async () => {
      // Public tier, but the delivery tier resolves to private because a
      // signed-policy playback id gates the object graph. The share route must
      // treat it as gated, not hand it a long-lived cacheable capability map.
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);
      vi.mocked(deps.resolveObjectTier).mockResolvedValue('private');

      const res = await request(createApp()).get('/asset-1/share?expires_in=999999');

      expect(deps.resolveObjectTier).toHaveBeenCalledWith('manifest-obj-1');
      expect(deps.createShareUrls).toHaveBeenCalledWith('asset-1', 'manifest-obj-1', 3600);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('returns 404 when the asset is not found', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(404);
      expect(deps.createShareUrls).not.toHaveBeenCalled();
      expect(deps.resolveObjectTier).not.toHaveBeenCalled();
    });

    it('returns 409 when the asset is not ready', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        ...readyAsset,
        manifestObjectId: null,
        status: 'processing',
      });

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(409);
      expect(deps.createShareUrls).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the calling tenant', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      await request(createApp()).get('/asset-1/share');

      expect(deps.getPlaybackAsset).toHaveBeenCalledWith('asset-1', '0xabc123');
    });

    it('requires read scope', async () => {
      const app = withApiKey(createTestApp(createPlaybackRoutes(deps)), {
        ...defaultApiKey,
        scopes: ['upload'],
      });

      const res = await request(app).get('/asset-1/share');

      expect(res.status).toBe(403);
    });
  });

  describe('cross-tenant isolation', () => {
    // Model the real ownership rule: the lookup resolves an asset only for its
    // owner, so another tenant's key sees a miss.
    const OWNER = '0xowner';
    function ownedApp(callerAddress: string) {
      const scoped: PlaybackRouteDeps = {
        getPlaybackAsset: vi.fn(async (_id: string, owner?: string) =>
          owner === OWNER
            ? {
                id: 'asset-1',
                manifestObjectId: 'manifest-obj-1',
                thumbnailObjectIds: [],
                durationMs: 1,
                resolution: '1280x720',
                accessTier: 'private' as const,
                status: 'ready',
              }
            : null,
        ),
        generateSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://signed.url/manifest',
          expiresAt: '2025-06-01T00:00:00Z',
        }),
        createShareUrls: vi.fn().mockResolvedValue({
          masterObjectId: 'manifest-obj-1',
          shares: { 'manifest-obj-1': 'sia://ref#key' },
          expiresAt: '2025-06-01T01:00:00Z',
        }),
        resolveObjectTier: vi.fn().mockResolvedValue('public'),
      };
      return withApiKey(createTestApp(createPlaybackRoutes(scoped)), {
        ...defaultApiKey,
        creatorAddress: callerAddress,
      });
    }

    it('serves the owner but returns 404 to a different tenant', async () => {
      expect((await request(ownedApp(OWNER)).get('/asset-1')).status).toBe(200);
      expect((await request(ownedApp('0xstranger')).get('/asset-1')).status).toBe(404);
    });

    it('refuses a signed URL for another tenant asset', async () => {
      const res = await request(ownedApp('0xstranger')).get('/asset-1/signed');
      expect(res.status).toBe(404);
    });
  });
});

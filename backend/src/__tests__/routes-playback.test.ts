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
      expect(res.body).toEqual({
        signedUrl: 'https://signed.url/manifest',
        expiresAt: '2025-06-01T00:00:00Z',
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
});

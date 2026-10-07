import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createPlaybackRoutes, type PlaybackRouteDeps } from '../api/routes/playback.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import { registry } from '../metrics/collector.js';
import { ShareMintError } from '../delivery/share-expiry.js';

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
        posterUrl: 'https://signed.url/poster',
        expiresAt: '2025-06-01T00:00:00Z',
      }),
      revokeSignedUrls: vi.fn().mockResolvedValue({ signingGeneration: 1 }),
      createShareUrls: vi.fn().mockResolvedValue({
        masterObjectId: 'manifest-obj-1',
        shares: { 'manifest-obj-1': 'sia://ref#key', 'data-obj-1': 'sia://ref2#key2' },
        expiresAt: '2025-06-01T01:00:00Z',
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
        signingGeneration: 0,
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
        signingGeneration: 0,
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
        signingGeneration: 0,
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
        signingGeneration: 0,
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
        signingGeneration: 0,
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
        signingGeneration: 0,
      });

      const res = await request(createApp()).get('/asset-1/signed');

      expect(res.status).toBe(200);
      // Wire format is snake_case, matching every other endpoint and what the
      // SDK reads. Returning camelCase here left the SDK with undefined fields.
      expect(res.body).toEqual({
        signed_url: 'https://signed.url/manifest',
        poster_url: 'https://signed.url/poster',
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
        signingGeneration: 0,
      });

      await request(createApp()).get('/asset-1/signed');

      expect(deps.generateSignedUrl).toHaveBeenCalledWith(
        { manifestObjectId: 'manifest-obj-1', posterObjectId: null, signingGeneration: 0 },
        3600,
      );
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
        signingGeneration: 0,
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
        signingGeneration: 0,
      });

      await request(createApp()).get('/asset-1/signed?expires_in=7200');

      expect(deps.generateSignedUrl).toHaveBeenCalledWith(expect.anything(), 7200);
    });

    it('signs the first thumbnail as the poster, under the asset signing generation', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: ['thumb-1', 'thumb-2'],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
        signingGeneration: 5,
      });

      await request(createApp()).get('/asset-1/signed');

      expect(deps.generateSignedUrl).toHaveBeenCalledWith(
        { manifestObjectId: 'manifest-obj-1', posterObjectId: 'thumb-1', signingGeneration: 5 },
        3600,
      );
    });

    it('bounds expires_in to between a minute and six hours', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
        signingGeneration: 0,
      });

      for (const [asked, minted] of [
        ['315360000', 21600],
        ['99999999999999', 21600],
        ['21601', 21600],
        ['21600', 21600],
        ['0', 60],
        ['5', 60],
      ] as const) {
        vi.mocked(deps.generateSignedUrl).mockClear();
        const res = await request(createApp()).get(`/asset-1/signed?expires_in=${asked}`);
        expect(res.status, asked).toBe(200);
        expect(deps.generateSignedUrl).toHaveBeenCalledWith(expect.anything(), minted);
      }
    });

    it('refuses an expires_in that is not a whole number of seconds', async () => {
      for (const bad of ['-100', '1.5', 'abc', '1e9', '']) {
        const res = await request(createApp()).get(`/asset-1/signed?expires_in=${bad}`);
        expect(res.status, bad).toBe(400);
      }
      expect(deps.generateSignedUrl).not.toHaveBeenCalled();
    });

    it('counts a signed playback once per url handed out, never for a refused request', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        id: 'asset-1',
        manifestObjectId: 'manifest-obj-1',
        thumbnailObjectIds: [],
        durationMs: 60000,
        resolution: '1280x720',
        accessTier: 'private',
        status: 'ready',
        signingGeneration: 0,
      });
      const signedCount = async () =>
        (await registry.getMetricsAsJSON())
          .find((m) => m.name === 'sluby_playback_initiation_total')
          ?.values.find((v) => v.labels.mode === 'signed')?.value ?? 0;

      const before = await signedCount();
      await request(createApp()).get('/asset-1/signed?expires_in=-60');
      expect(await signedCount()).toBe(before);

      await request(createApp()).get('/asset-1/signed');
      expect(await signedCount()).toBe(before + 1);
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
        signingGeneration: 0,
      });

      const res = await request(createApp()).get('/asset-1/signed');

      expect(res.status).toBe(409);
    });
  });

  describe('POST /:id/signed/revoke', () => {
    const readyAsset = {
      id: 'asset-uuid-1',
      manifestObjectId: 'manifest-obj-1',
      thumbnailObjectIds: [],
      durationMs: 60000,
      resolution: '1280x720',
      accessTier: 'private',
      status: 'ready',
      signingGeneration: 0,
    };

    it('raises the generation of the resolved asset, scoped to the caller', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      const res = await request(createApp()).post('/pb_abc/signed/revoke');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, signing_generation: 1 });
      expect(deps.getPlaybackAsset).toHaveBeenCalledWith('pb_abc', '0xabc123');
      expect(deps.revokeSignedUrls).toHaveBeenCalledWith('asset-uuid-1', '0xabc123');
    });

    it('answers 404 for an unknown asset', async () => {
      const res = await request(createApp()).post('/asset-1/signed/revoke');
      expect(res.status).toBe(404);
      expect(deps.revokeSignedUrls).not.toHaveBeenCalled();
    });

    it('requires manage scope', async () => {
      const app = withApiKey(createTestApp(createPlaybackRoutes(deps)), {
        ...defaultApiKey,
        scopes: ['read'],
      });
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);
      expect((await request(app).post('/asset-1/signed/revoke')).status).toBe(403);
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
      signingGeneration: 0,
    };

    // the fourth argument is the hard limit (unix seconds): now plus the cap
    function expectMint(expiresIn: number, capSec: number) {
      expect(deps.createShareUrls).toHaveBeenCalledWith(
        'asset-1',
        'manifest-obj-1',
        expiresIn,
        expect.any(Number),
      );
      const notAfter = vi.mocked(deps.createShareUrls).mock.calls[0][3];
      const expected = Math.floor(Date.now() / 1000) + capSec;
      expect(Math.abs(notAfter - expected)).toBeLessThanOrEqual(2);
    }

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

    it('answers 502 when the indexer fails while minting', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);
      vi.mocked(deps.createShareUrls).mockRejectedValue(
        new ShareMintError('indexer', new Error('app error: Reqwest(...)')),
      );

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/Sia indexer/);
    });

    it('answers 503 and names the database when the object list cannot be read', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);
      vi.mocked(deps.createShareUrls).mockRejectedValue(
        new ShareMintError('database', new Error('connection refused')),
      );

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/database/);
    });

    it('mints against the resolved asset id and the default hour', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      await request(createApp()).get('/asset-1/share');

      expectMint(3600, 21600);
    });

    it('clamps a public request to the six-hour ceiling', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      await request(createApp()).get('/asset-1/share?expires_in=999999');

      expectMint(21600, 21600);
    });

    it('caps a private asset to one hour and marks the response no-store', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        ...readyAsset,
        accessTier: 'private',
      });

      const res = await request(createApp()).get('/asset-1/share?expires_in=999999');

      expectMint(3600, 3600);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('follows only the asset tier, so a signed playback id on a public asset changes nothing', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(readyAsset);

      const res = await request(createApp()).get('/asset-1/share?expires_in=999999');

      expectMint(21600, 21600);
      expect(res.headers['cache-control']).toBeUndefined();
    });

    it('returns 404 when the asset is not found', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue(null);

      const res = await request(createApp()).get('/asset-1/share');

      expect(res.status).toBe(404);
      expect(deps.createShareUrls).not.toHaveBeenCalled();
    });

    it('returns 409 when the asset is not ready', async () => {
      vi.mocked(deps.getPlaybackAsset).mockResolvedValue({
        ...readyAsset,
        manifestObjectId: null,
        status: 'processing',
        signingGeneration: 0,
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
                signingGeneration: 0,
              }
            : null,
        ),
        generateSignedUrl: vi.fn().mockResolvedValue({
          signedUrl: 'https://signed.url/manifest',
          posterUrl: null,
          expiresAt: '2025-06-01T00:00:00Z',
        }),
        revokeSignedUrls: vi.fn().mockResolvedValue({ signingGeneration: 1 }),
        createShareUrls: vi.fn().mockResolvedValue({
          masterObjectId: 'manifest-obj-1',
          shares: { 'manifest-obj-1': 'sia://ref#key' },
          expiresAt: '2025-06-01T01:00:00Z',
        }),
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

    it('refuses to revoke another tenant asset', async () => {
      const res = await request(ownedApp('0xstranger')).post('/asset-1/signed/revoke');
      expect(res.status).toBe(404);
    });
  });
});

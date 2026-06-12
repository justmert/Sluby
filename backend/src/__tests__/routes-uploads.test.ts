import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createUploadRoutes, type UploadRouteDeps } from '../api/routes/uploads.js';
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

describe('upload routes', () => {
  let deps: UploadRouteDeps;

  beforeEach(() => {
    deps = {
      createUploadSession: vi.fn().mockResolvedValue({
        videoAssetId: 'asset-1',
        uploadUrl: '/api/v1/uploads/session-1',
      }),
      getUploadStatus: vi.fn().mockResolvedValue(null),
      cancelUpload: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createApp() {
    const router = createUploadRoutes(deps);
    const app = createTestApp(router);
    return withApiKey(app, defaultApiKey);
  }

  describe('POST /', () => {
    it('should create a new upload session', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ title: 'My Video', description: 'A great video' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        video_asset_id: 'asset-1',
        upload_url: '/api/v1/uploads/session-1',
      });
    });

    it('should pass correct parameters to createUploadSession', async () => {
      await request(createApp())
        .post('/')
        .send({
          title: 'My Video',
          description: 'desc',
          access_tier: 'private',
        });

      expect(deps.createUploadSession).toHaveBeenCalledWith({
        apiKeyId: 'key-1',
        creatorAddress: '0xabc123',
        title: 'My Video',
        description: 'desc',
        accessTier: 'private',
      });
    });

    it('should default description to empty string', async () => {
      await request(createApp())
        .post('/')
        .send({ title: 'My Video' });

      expect(deps.createUploadSession).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' }),
      );
    });

    it('should default accessTier to public', async () => {
      await request(createApp())
        .post('/')
        .send({ title: 'My Video' });

      expect(deps.createUploadSession).toHaveBeenCalledWith(
        expect.objectContaining({ accessTier: 'public' }),
      );
    });

    it('should return 400 when title is missing', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ description: 'no title' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Title is required');
    });

    it('should return 500 when createUploadSession throws', async () => {
      vi.mocked(deps.createUploadSession).mockRejectedValue(new Error('Upload creation failed'));

      const res = await request(createApp())
        .post('/')
        .send({ title: 'My Video' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to create upload session');
    });

    it('should require upload scope', async () => {
      const router = createUploadRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp)
        .post('/')
        .send({ title: 'My Video' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id', () => {
    it('should return upload status', async () => {
      vi.mocked(deps.getUploadStatus).mockResolvedValue({
        id: 'session-1',
        status: 'uploading',
        progressPercent: 50,
        fileSize: 1_000_000,
        uploadedBytes: 500_000,
        videoAssetId: 'asset-1',
      });

      const res = await request(createApp()).get('/session-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 'session-1',
        status: 'uploading',
        progressPercent: 50,
        fileSize: 1_000_000,
        uploadedBytes: 500_000,
        videoAssetId: 'asset-1',
      });
    });

    it('should return 404 when session not found', async () => {
      vi.mocked(deps.getUploadStatus).mockResolvedValue(null);

      const res = await request(createApp()).get('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Upload session not found');
    });

    it('should require read scope', async () => {
      const router = createUploadRoutes(deps);
      const app = createTestApp(router);
      const noReadApp = withApiKey(app, { ...defaultApiKey, scopes: ['upload'] });

      const res = await request(noReadApp).get('/session-1');

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /:id', () => {
    it('should cancel an upload and return success', async () => {
      const res = await request(createApp()).delete('/session-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(deps.cancelUpload).toHaveBeenCalledWith('session-1');
    });

    it('should require upload scope', async () => {
      const router = createUploadRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp).delete('/session-1');

      expect(res.status).toBe(403);
    });
  });
});

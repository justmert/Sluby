import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createUploadRoutes, type UploadRouteDeps } from '../api/routes/uploads.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
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
      getUploadStatus: vi.fn().mockResolvedValue(null),
      cancelUpload: vi.fn().mockResolvedValue(true),
    };
  });

  function createApp() {
    const router = createUploadRoutes(deps);
    const app = createTestApp(router);
    return withApiKey(app, defaultApiKey);
  }

  describe('GET /:id', () => {
    it('returns upload status serialized as snake_case, owner-scoped', async () => {
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
        video_asset_id: 'asset-1',
        status: 'uploading',
        progress_percent: 50,
        file_size: 1_000_000,
        uploaded_bytes: 500_000,
      });
      // Owner is threaded so one tenant cannot read another's session.
      expect(deps.getUploadStatus).toHaveBeenCalledWith('session-1', '0xabc123');
    });

    it('returns 404 when the session is missing or not owned', async () => {
      vi.mocked(deps.getUploadStatus).mockResolvedValue(null);
      const res = await request(createApp()).get('/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Upload session not found');
    });

    it('requires read scope', async () => {
      const app = withApiKey(createTestApp(createUploadRoutes(deps)), {
        ...defaultApiKey,
        scopes: ['upload'],
      });
      const res = await request(app).get('/session-1');
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /:id', () => {
    it('cancels an upload, owner-scoped, and returns success', async () => {
      const res = await request(createApp()).delete('/session-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(deps.cancelUpload).toHaveBeenCalledWith('session-1', '0xabc123');
    });

    it('returns 404 when cancel matches no owned session', async () => {
      vi.mocked(deps.cancelUpload).mockResolvedValue(false);
      const res = await request(createApp()).delete('/session-1');
      expect(res.status).toBe(404);
    });

    it('requires upload scope', async () => {
      const app = withApiKey(createTestApp(createUploadRoutes(deps)), {
        ...defaultApiKey,
        scopes: ['read'],
      });
      const res = await request(app).delete('/session-1');
      expect(res.status).toBe(403);
    });
  });
});

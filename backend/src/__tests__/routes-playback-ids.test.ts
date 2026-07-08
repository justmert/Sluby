import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createPlaybackIdRoutes,
  type PlaybackIdRouteDeps,
} from '../api/routes/playback-ids.js';
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

function mockRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    playbackId: 'pb_abcdefghijklmnopqrstu',
    policy: 'public',
    name: 'embed',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('playback id routes', () => {
  let deps: PlaybackIdRouteDeps;

  beforeEach(() => {
    deps = {
      createPlaybackId: vi.fn().mockResolvedValue(mockRecord()),
      listPlaybackIds: vi.fn().mockResolvedValue([mockRecord()]),
      deletePlaybackId: vi.fn().mockResolvedValue(true),
    };
  });

  function app(key = defaultApiKey) {
    return withApiKey(createTestApp(createPlaybackIdRoutes(deps)), key);
  }

  describe('POST /assets/:assetId/playback-ids', () => {
    it('creates a playback id and returns 201 with snake_case fields', async () => {
      const res = await request(app())
        .post('/assets/asset-1/playback-ids')
        .send({ policy: 'public', name: 'embed' });

      expect(res.status).toBe(201);
      expect(deps.createPlaybackId).toHaveBeenCalledWith('asset-1', {
        policy: 'public',
        name: 'embed',
      });
      expect(res.body.playback_id).toBe('pb_abcdefghijklmnopqrstu');
      expect(res.body.policy).toBe('public');
      expect(res.body.created_at).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns 404 when the asset does not exist', async () => {
      vi.mocked(deps.createPlaybackId).mockResolvedValue(null);

      const res = await request(app()).post('/assets/missing/playback-ids').send({});

      expect(res.status).toBe(404);
    });

    it('rejects an invalid policy with 400', async () => {
      const res = await request(app())
        .post('/assets/asset-1/playback-ids')
        .send({ policy: 'nonsense' });

      expect(res.status).toBe(400);
      expect(deps.createPlaybackId).not.toHaveBeenCalled();
    });

    it('requires the manage scope', async () => {
      const res = await request(app({ ...defaultApiKey, scopes: ['read'] }))
        .post('/assets/asset-1/playback-ids')
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('GET /assets/:assetId/playback-ids', () => {
    it('lists playback ids for an asset', async () => {
      const res = await request(app()).get('/assets/asset-1/playback-ids');

      expect(res.status).toBe(200);
      expect(deps.listPlaybackIds).toHaveBeenCalledWith('asset-1');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].playback_id).toBe('pb_abcdefghijklmnopqrstu');
    });

    it('requires the read scope', async () => {
      const res = await request(app({ ...defaultApiKey, scopes: ['upload'] })).get(
        '/assets/asset-1/playback-ids',
      );
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /playback-ids/:playbackId', () => {
    it('deletes a playback id and returns success', async () => {
      const res = await request(app()).delete('/playback-ids/pb_abcdefghijklmnopqrstu');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(deps.deletePlaybackId).toHaveBeenCalledWith('pb_abcdefghijklmnopqrstu');
    });

    it('returns 404 when the playback id was not found', async () => {
      vi.mocked(deps.deletePlaybackId).mockResolvedValue(false);
      const res = await request(app()).delete('/playback-ids/pb_missing');
      expect(res.status).toBe(404);
    });

    it('requires the manage scope', async () => {
      const res = await request(app({ ...defaultApiKey, scopes: ['read'] })).delete(
        '/playback-ids/pb_x',
      );
      expect(res.status).toBe(403);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createWebhookRoutes, type WebhookRouteDeps } from '../api/routes/webhooks.js';
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

describe('webhook routes', () => {
  let deps: WebhookRouteDeps;

  beforeEach(() => {
    deps = {
      createWebhook: vi.fn().mockResolvedValue({ id: 'wh-1' }),
      listWebhooks: vi.fn().mockResolvedValue([]),
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createApp() {
    const router = createWebhookRoutes(deps);
    const app = createTestApp(router);
    return withApiKey(app, defaultApiKey);
  }

  describe('POST /', () => {
    it('should create a webhook and return its details with secret', async () => {
      const res = await request(createApp())
        .post('/')
        .send({
          url: 'https://example.com/webhook',
          events: ['upload.completed', 'asset.ready'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('wh-1');
      expect(res.body.url).toBe('https://example.com/webhook');
      expect(res.body.events).toEqual(['upload.completed', 'asset.ready']);
      // Secret should be a 64-char hex string (32 random bytes)
      expect(res.body.secret).toBeDefined();
      expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should pass correct data to createWebhook dep', async () => {
      await request(createApp())
        .post('/')
        .send({
          url: 'https://example.com/hook',
          events: ['upload.completed'],
        });

      expect(deps.createWebhook).toHaveBeenCalledWith({
        apiKeyId: 'key-1',
        url: 'https://example.com/hook',
        events: ['upload.completed'],
        secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });

    it('should return 400 when URL is missing', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ events: ['upload.completed'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });

    it('should return 400 when events is missing', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'https://example.com/hook' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('At least one event type is required');
    });

    it('should return 400 when events is empty array', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'https://example.com/hook', events: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('At least one event type is required');
    });

    it('should return 400 when events is not an array', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'https://example.com/hook', events: 'upload.completed' });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid event types', async () => {
      const res = await request(createApp())
        .post('/')
        .send({
          url: 'https://example.com/hook',
          events: ['upload.completed', 'invalid.event'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid.event');
    });

    it('should accept all valid event types', async () => {
      const validEvents = [
        'upload.started',
        'upload.completed',
        'upload.failed',
        'processing.started',
        'processing.progress',
        'asset.ready',
        'asset.errored',
      ];

      const res = await request(createApp())
        .post('/')
        .send({
          url: 'https://example.com/hook',
          events: validEvents,
        });

      expect(res.status).toBe(201);
    });

    it('should require manage scope', async () => {
      const router = createWebhookRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp)
        .post('/')
        .send({
          url: 'https://example.com/hook',
          events: ['upload.completed'],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /', () => {
    it('should return a list of webhooks', async () => {
      vi.mocked(deps.listWebhooks).mockResolvedValue([
        {
          id: 'wh-1',
          url: 'https://example.com/hook1',
          events: ['upload.completed'],
          isActive: true,
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
        {
          id: 'wh-2',
          url: 'https://example.com/hook2',
          events: ['asset.ready', 'asset.errored'],
          isActive: false,
          createdAt: new Date('2025-01-02T00:00:00Z'),
        },
      ]);

      const res = await request(createApp()).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual({
        id: 'wh-1',
        url: 'https://example.com/hook1',
        events: ['upload.completed'],
        is_active: true,
        created_at: '2025-01-01T00:00:00.000Z',
      });
    });

    it('should call listWebhooks with the API key ID', async () => {
      await request(createApp()).get('/');

      expect(deps.listWebhooks).toHaveBeenCalledWith('key-1');
    });

    it('should return empty data array when no webhooks', async () => {
      vi.mocked(deps.listWebhooks).mockResolvedValue([]);

      const res = await request(createApp()).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('should require read scope', async () => {
      const router = createWebhookRoutes(deps);
      const app = createTestApp(router);
      const noReadApp = withApiKey(app, { ...defaultApiKey, scopes: ['upload'] });

      const res = await request(noReadApp).get('/');

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /:id', () => {
    it('should delete a webhook and return success', async () => {
      vi.mocked(deps.deleteWebhook).mockResolvedValue(true);

      const res = await request(createApp()).delete('/wh-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      // Scoped to the calling key so one caller cannot delete another's webhook.
      expect(deps.deleteWebhook).toHaveBeenCalledWith('wh-1', 'key-1');
    });

    it("should return 404 when the webhook belongs to another key", async () => {
      vi.mocked(deps.deleteWebhook).mockResolvedValue(false);

      const res = await request(createApp()).delete('/wh-not-mine');

      expect(res.status).toBe(404);
    });

    it('should require manage scope', async () => {
      const router = createWebhookRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read'] });

      const res = await request(readOnlyApp).delete('/wh-1');

      expect(res.status).toBe(403);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createWebhookRoutes, type WebhookRouteDeps } from '../api/routes/webhooks.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import { EgressError, vetUrl } from '../webhooks/egress.js';

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

const FAKE_DNS: Record<string, string[]> = {
  'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'internal.example.com': ['10.1.2.3'],
  'rebind.example.com': ['93.184.215.14', '127.0.0.1'],
};
const fakeDns = async (host: string) => {
  const found = FAKE_DNS[host];
  if (!found) throw new Error('ENOTFOUND');
  return found.map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }));
};

describe('webhook routes', () => {
  let deps: WebhookRouteDeps;

  beforeEach(() => {
    deps = {
      createWebhook: vi.fn().mockResolvedValue({ id: 'wh-1' }),
      listWebhooks: vi.fn().mockResolvedValue([]),
      getWebhook: vi.fn().mockResolvedValue(null),
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
      // the real check, with no operator exemptions and a resolver that knows
      // a few test names, so registration is judged exactly as in production
      vetWebhookUrl: vi.fn(async (url: string) => {
        try {
          await vetUrl(url, { allowedNetworks: [], resolve: fakeDns });
          return null;
        } catch (err) {
          if (err instanceof EgressError) return err.message;
          throw err;
        }
      }),
      testWebhook: vi.fn().mockResolvedValue(null),
      listWebhookDeliveries: vi.fn().mockResolvedValue(null),
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
        creatorAddress: '0xabc123',
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

    it('answers 400 to a request with no body, which express 5 leaves undefined', async () => {
      const res = await request(createApp()).post('/');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });

    it('should return 400 when events is missing', async () => {
      const res = await request(createApp()).post('/').send({ url: 'https://example.com/hook' });

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
        'asset.ready',
        'asset.errored',
      ];

      const res = await request(createApp()).post('/').send({
        url: 'https://example.com/hook',
        events: validEvents,
      });

      expect(res.status).toBe(201);
    });

    it('records no key for a studio session, which has no key row', async () => {
      const app = withApiKey(createTestApp(createWebhookRoutes(deps)), {
        ...defaultApiKey,
        id: 'session:alice',
        creatorAddress: 'github:alice',
      });
      await request(app)
        .post('/')
        .send({ url: 'https://example.com/hook', events: ['asset.ready'] });
      expect(deps.createWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ creatorAddress: 'github:alice', apiKeyId: null }),
      );
    });

    it.each(['not a url', 'ftp://example.com/hook', '/relative'])(
      'rejects %s as a delivery url',
      async (url) => {
        const res = await request(createApp())
          .post('/')
          .send({ url, events: ['asset.ready'] });
        expect(res.status).toBe(400);
      },
    );

    it('rejects events the pipeline never emits', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'https://example.com/hook', events: ['processing.progress'] });
      expect(res.status).toBe(400);
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
          lastDeliveryAt: new Date('2025-01-03T00:00:00Z'),
          lastDeliveryOk: false,
        },
        {
          id: 'wh-2',
          url: 'https://example.com/hook2',
          events: ['asset.ready', 'asset.errored'],
          isActive: false,
          createdAt: new Date('2025-01-02T00:00:00Z'),
          lastDeliveryAt: null,
          lastDeliveryOk: null,
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
        last_delivery_at: '2025-01-03T00:00:00.000Z',
        last_delivery_ok: false,
      });
      expect(res.body.data[1]).toMatchObject({
        is_active: false,
        last_delivery_at: null,
        last_delivery_ok: null,
      });
    });

    it("lists the caller's account webhooks", async () => {
      await request(createApp()).get('/');

      expect(deps.listWebhooks).toHaveBeenCalledWith('0xabc123');
    });

    it('lists every account for the platform identity, through ownerFilter', async () => {
      const app = withApiKey(createTestApp(createWebhookRoutes(deps)), {
        ...defaultApiKey,
        creatorAddress: `0x${'0'.repeat(64)}`,
      });
      await request(app).get('/');
      await request(app).delete('/wh-1');
      await request(app).post('/wh-1/test');
      await request(app).get('/wh-1/deliveries');

      expect(deps.listWebhooks).toHaveBeenCalledWith(undefined);
      expect(deps.deleteWebhook).toHaveBeenCalledWith('wh-1', undefined);
      expect(deps.testWebhook).toHaveBeenCalledWith('wh-1', undefined);
      expect(deps.listWebhookDeliveries).toHaveBeenCalledWith('wh-1', undefined, 50);
    });

    it('should return empty data array when no webhooks', async () => {
      vi.mocked(deps.listWebhooks).mockResolvedValue([]);

      const res = await request(createApp()).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('needs manage, since receiver urls often carry credentials', async () => {
      const router = createWebhookRoutes(deps);
      const app = createTestApp(router);
      const readOnlyApp = withApiKey(app, { ...defaultApiKey, scopes: ['read', 'upload'] });

      const res = await request(readOnlyApp).get('/');

      expect(res.status).toBe(403);
      expect(deps.listWebhooks).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id', () => {
    it("answers one of the caller's endpoints", async () => {
      vi.mocked(deps.getWebhook).mockResolvedValue({
        id: 'wh-1',
        url: 'https://example.com/hook',
        events: ['asset.ready'],
        isActive: true,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        lastDeliveryAt: new Date('2025-01-02T00:00:00Z'),
        lastDeliveryOk: true,
      });
      const res = await request(createApp()).get('/wh-1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'wh-1', last_delivery_ok: true });
      expect(deps.getWebhook).toHaveBeenCalledWith('wh-1', '0xabc123');
    });

    it("answers 404 for an endpoint that is not the caller's", async () => {
      const res = await request(createApp()).get('/wh-9');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('should delete a webhook and return success', async () => {
      vi.mocked(deps.deleteWebhook).mockResolvedValue(true);

      const res = await request(createApp()).delete('/wh-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      // Scoped to the caller's account so one tenant cannot delete another's webhook.
      expect(deps.deleteWebhook).toHaveBeenCalledWith('wh-1', '0xabc123');
    });

    it('should return 404 when the webhook belongs to another key', async () => {
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
  describe('receiver url checks at registration', () => {
    it.each([
      'http://127.0.0.1:3000/api/v1/keys',
      'http://localhost:3000/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://[fd00:ec2::254]/latest/meta-data/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://0.0.0.0:6379/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://internal.example.com/hook',
      'http://rebind.example.com/hook',
      'http://nowhere.invalid/hook',
      'ftp://example.com/hook',
      'not a url',
    ])('refuses %s', async (url) => {
      const res = await request(createApp())
        .post('/')
        .send({ url, events: ['asset.ready'] });
      expect(res.status).toBe(400);
      expect(deps.createWebhook).not.toHaveBeenCalled();
    });

    it('accepts a public receiver', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'https://example.com/hook', events: ['asset.ready'] });
      expect(res.status).toBe(201);
    });

    it('says why a url was refused, without naming the address it resolved to', async () => {
      const res = await request(createApp())
        .post('/')
        .send({ url: 'http://internal.example.com/hook', events: ['asset.ready'] });
      expect(res.body.error).toBe(
        'URL refused: internal.example.com resolves to an address webhooks may not reach: private (10.0.0.0/8)',
      );
      expect(JSON.stringify(res.body)).not.toContain('10.1.2.3');
    });
  });

  describe('POST /:id/test', () => {
    it("sends a test event to the caller's endpoint and reports the outcome", async () => {
      vi.mocked(deps.testWebhook).mockResolvedValue({
        delivered: false,
        statusCode: 500,
        error: 'the receiver answered 500',
      });
      const res = await request(createApp()).post('/wh-1/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        delivered: false,
        status_code: 500,
        error: 'the receiver answered 500',
      });
      expect(deps.testWebhook).toHaveBeenCalledWith('wh-1', '0xabc123');
    });

    it("answers 404 for an endpoint that is not the caller's", async () => {
      const res = await request(createApp()).post('/wh-other/test');
      expect(res.status).toBe(404);
    });

    it('needs manage', async () => {
      const app = withApiKey(createTestApp(createWebhookRoutes(deps)), {
        ...defaultApiKey,
        scopes: ['read'],
      });
      expect((await request(app).post('/wh-1/test')).status).toBe(403);
    });
  });

  describe('GET /:id/deliveries', () => {
    it('lists the latest attempts without any response body', async () => {
      vi.mocked(deps.listWebhookDeliveries).mockResolvedValue([
        {
          id: 'd2',
          eventId: 'evt_2',
          event: 'asset.ready',
          statusCode: 204,
          error: null,
          attempt: 2,
          createdAt: new Date('2026-10-01T00:00:10Z'),
        },
        {
          id: 'd1',
          eventId: 'evt_2',
          event: 'asset.ready',
          statusCode: null,
          error: 'timed out',
          attempt: 1,
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      ]);
      const res = await request(createApp()).get('/wh-1/deliveries').query({ limit: 10 });
      expect(res.status).toBe(200);
      expect(deps.listWebhookDeliveries).toHaveBeenCalledWith('wh-1', '0xabc123', 10);
      expect(res.body.data).toEqual([
        {
          id: 'd2',
          event_id: 'evt_2',
          event: 'asset.ready',
          status_code: 204,
          delivered: true,
          error: null,
          attempt: 2,
          created_at: '2026-10-01T00:00:10.000Z',
        },
        {
          id: 'd1',
          event_id: 'evt_2',
          event: 'asset.ready',
          status_code: null,
          delivered: false,
          error: 'timed out',
          attempt: 1,
          created_at: '2026-10-01T00:00:00.000Z',
        },
      ]);
    });

    it.each(['0', '101', 'abc', '1.5'])('rejects limit=%s', async (limit) => {
      const res = await request(createApp()).get('/wh-1/deliveries').query({ limit });
      expect(res.status).toBe(400);
    });

    it("answers 404 for an endpoint that is not the caller's", async () => {
      const res = await request(createApp()).get('/wh-other/deliveries');
      expect(res.status).toBe(404);
    });
  });
});

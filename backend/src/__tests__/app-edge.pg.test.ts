import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import pino from 'pino';
import type { Express } from 'express';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AppModule from '../app.js';
import type * as EnvModule from '../config/env.js';
import type * as Database from '../config/database.js';
import type * as ApiKeyQueries from '../db/queries/api-keys.js';

/**
 * The edge of the real app: createApp with every route mounted on a real
 * database, driven over HTTP the way a browser or a proxy reaches it. Covers
 * cors, cross-origin writes, the per-IP limiter and the client address it
 * keys on, the key caps, the metrics guard and the banner.
 */
describe.skipIf(!hasTestDatabase)('app edge: cors, limits and headers (postgres)', () => {
  let tdb: TestDatabase;
  let appModule: typeof AppModule;
  let env: typeof EnvModule.env;
  let database: typeof Database;
  let keys: typeof ApiKeyQueries;

  const SELF = 'http://sluby.test';
  const EVIL = 'https://evil.example';
  const LISTED = 'https://studio.example';

  const queue = { add: async () => undefined, getJobCounts: async () => ({}) };

  // a fresh app per test, built from whatever the test set on env
  function app(): Express {
    return appModule.createApp({
      logger: pino({ level: 'silent' }),
      version: 'test',
      startedAt: new Date(),
      queues: { transcode: queue, uploadSegments: queue, finalize: queue, deletion: queue },
      pingRedis: async () => {},
      webhookDispatcher: { dispatch: async () => {}, enqueue: async () => {} },
      triggerReconciliation: async () => ({ enqueued: false }),
    }).app;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'sluby-edge-uploads-'));
    process.env.PUBLIC_URL = SELF;
    process.env.SESSION_SECRET = 'an-edge-test-session-secret-that-is-long-enough';
    appModule = await import('../app.js');
    env = (await import('../config/env.js')).env;
    database = await import('../config/database.js');
    keys = await import('../db/queries/api-keys.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  const defaults = () => ({
    AUTH_DISABLED: false,
    CORS_ORIGIN: [] as string[],
    TRUST_PROXY: 'loopback, linklocal, uniquelocal' as string | number | boolean,
    API_IP_RATE_LIMIT: 600,
    API_KEY_RATE_LIMIT_MAX: 10000,
    API_KEYS_PER_ACCOUNT_MAX: 100,
    METRICS_TOKEN: undefined as string | undefined,
  });

  beforeEach(async () => {
    await tdb.truncate();
    Object.assign(env, defaults());
  });

  async function newKey(scopes = ['upload', 'read', 'manage'], owner = 'workspace') {
    const { rawKey } = await keys.createApiKey({ name: 'k', scopes, creatorAddress: owner });
    return rawKey;
  }

  describe('cors with AUTH_DISABLED on and CORS_ORIGIN unset', () => {
    beforeEach(() => {
      env.AUTH_DISABLED = true;
    });

    it('gives another origin nothing it can read', async () => {
      const res = await request(app()).get('/api/v1/keys').set('Origin', EVIL);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('fails the preflight of another origin, on the api and on tus', async () => {
      const api = await request(app())
        .options('/api/v1/keys')
        .set('Origin', EVIL)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');
      expect(api.headers['access-control-allow-origin']).toBeUndefined();

      const tus = await request(app())
        .options('/api/v1/uploads')
        .set('Origin', EVIL)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'tus-resumable,upload-length');
      expect(tus.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses a form post from another origin, which needs no preflight', async () => {
      const res = await request(app())
        .post('/api/v1/webhooks')
        .set('Origin', EVIL)
        .type('form')
        .send('url=https://evil.example/hook&events[]=asset.ready');
      expect(res.status).toBe(403);
      const rows = await tdb.sql`select count(*)::int as n from webhook_endpoints`;
      expect(rows[0].n).toBe(0);
    });

    it('still serves the studio on its own origin', async () => {
      const res = await request(app())
        .post('/api/v1/keys')
        .set('Host', 'sluby.test')
        .set('Origin', SELF)
        .send({ name: 'mine' });
      expect(res.status).toBe(201);
    });

    it('gives a listed origin credentialed cors', async () => {
      env.CORS_ORIGIN = [LISTED];
      const res = await request(app()).get('/api/v1/openapi.json').set('Origin', LISTED);
      expect(res.headers['access-control-allow-origin']).toBe(LISTED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      const other = await request(app()).get('/api/v1/openapi.json').set('Origin', EVIL);
      expect(other.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('cors with auth on', () => {
    it('lets any origin call with a bearer key, never with credentials', async () => {
      const key = await newKey();
      const preflight = await request(app())
        .options('/api/v1/assets')
        .set('Origin', EVIL)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization');
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('*');
      expect(preflight.headers['access-control-allow-headers']).toMatch(/Authorization/);
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();

      const res = await request(app())
        .get('/api/v1/assets')
        .set('Origin', EVIL)
        .set('Authorization', `Bearer ${key}`);
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('lets a cross-origin bearer caller write, since its header needed a preflight', async () => {
      const key = await newKey();
      const res = await request(app())
        .post('/api/v1/keys')
        .set('Origin', EVIL)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'from elsewhere' });
      expect(res.status).toBe(201);
    });

    it('answers a tus preflight from another origin without credentials', async () => {
      const res = await request(app())
        .options('/api/v1/uploads')
        .set('Origin', EVIL)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,tus-resumable,upload-length');
      expect(res.headers['access-control-allow-origin']).toBeDefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('trusts only listed origins with credentials and varies on Origin', async () => {
      env.CORS_ORIGIN = [LISTED];
      const listed = await request(app())
        .options('/api/v1/assets')
        .set('Origin', LISTED)
        .set('Access-Control-Request-Method', 'DELETE');
      expect(listed.headers['access-control-allow-origin']).toBe(LISTED);
      expect(listed.headers['access-control-allow-credentials']).toBe('true');
      expect(listed.headers.vary).toMatch(/Origin/);

      const other = await request(app()).get('/api/v1/openapi.json').set('Origin', EVIL);
      expect(other.headers['access-control-allow-origin']).toBe('*');
      expect(other.headers['access-control-allow-credentials']).toBeUndefined();
      expect(other.headers.vary).toMatch(/Origin/);
    });

    it('refuses a cookie-borne form post from a same-site origin', async () => {
      const res = await request(app())
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://blog.sluby.test')
        .type('form')
        .send('');
      expect(res.status).toBe(403);
    });
  });

  describe('delivery cors', () => {
    it('answers a ranged preflight itself, any origin and no credentials', async () => {
      const res = await request(app())
        .options('/v1/objects/abc')
        .set('Origin', EVIL)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'range');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toMatch(/Range/);
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('sends no credentials header on a delivery response', async () => {
      const res = await request(app())
        .get('/v1/share/00000000-0000-4000-8000-000000000000')
        .set('Origin', EVIL);
      expect(res.status).toBe(404);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('per-IP limit for unauthenticated calls', () => {
    beforeEach(() => {
      env.API_IP_RATE_LIMIT = 5;
    });

    it('cuts off one client after the limit with Retry-After, not its neighbour', async () => {
      const a = app();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(a)
          .get('/api/v1/assets')
          .set('X-Forwarded-For', '203.0.113.9')
          .set('Authorization', 'Bearer sluby_wrong');
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      const limited = await request(a).get('/api/v1/auth/me').set('X-Forwarded-For', '203.0.113.9');
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      const other = await request(a).get('/api/v1/auth/me').set('X-Forwarded-For', '203.0.113.10');
      expect(other.status).toBe(401);
      expect(other.headers['x-ratelimit-limit']).toBe('5');
    });

    it('keys on the client behind caddy and nginx, not on the proxy', async () => {
      const a = app();
      // caddy's address is the last hop nginx would append without realip
      for (let i = 0; i < 5; i++) {
        await request(a)
          .get('/api/v1/openapi.json')
          .set('X-Forwarded-For', '198.51.100.7, 172.18.0.5');
      }
      const same = await request(a)
        .get('/api/v1/openapi.json')
        .set('X-Forwarded-For', '198.51.100.7, 172.18.0.5');
      expect(same.status).toBe(429);
      const neighbour = await request(a)
        .get('/api/v1/openapi.json')
        .set('X-Forwarded-For', '198.51.100.8, 172.18.0.5');
      expect(neighbour.status).toBe(200);
    });

    it('does not count calls that authenticate', async () => {
      const key = await newKey();
      const a = app();
      for (let i = 0; i < 20; i++) {
        const res = await request(a)
          .get('/api/v1/assets')
          .set('X-Forwarded-For', '203.0.113.20')
          .set('Authorization', `Bearer ${key}`);
        expect(res.status).toBe(200);
      }
      const anon = await request(a).get('/api/v1/auth/me').set('X-Forwarded-For', '203.0.113.20');
      expect(anon.status).toBe(401);
    });
  });

  describe('per-key limits', () => {
    it('holds a key to the operator maximum whatever it asked for', async () => {
      env.API_KEY_RATE_LIMIT_MAX = 3;
      const { rawKey } = await keys.createApiKey({
        name: 'greedy',
        scopes: ['read'],
        creatorAddress: 'workspace',
        rateLimit: 1_000_000_000,
      });
      const a = app();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await request(a).get('/api/v1/assets').set('Authorization', `Bearer ${rawKey}`);
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    });

    it('refuses a rate_limit above the maximum at creation', async () => {
      env.API_KEY_RATE_LIMIT_MAX = 50;
      const key = await newKey();
      const res = await request(app())
        .post('/api/v1/keys')
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'greedy', rate_limit: 1_000_000_000 });
      expect(res.status).toBe(400);
    });

    it('caps the keys the workspace holds, even under parallel creation', async () => {
      env.API_KEYS_PER_ACCOUNT_MAX = 3;
      const key = await newKey();
      const a = app();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          request(a)
            .post('/api/v1/keys')
            .set('Authorization', `Bearer ${key}`)
            .send({ name: `k${i}` }),
        ),
      );
      const created = results.filter((r) => r.status === 201).length;
      expect(created).toBe(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      const rows =
        await tdb.sql`select count(*)::int as n from api_keys where creator_address = 'workspace'`;
      expect(rows[0].n).toBe(3);
    });
  });

  describe('metrics and banners', () => {
    it('does not announce express', async () => {
      const res = await request(app()).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('asks for the scrape token when one is set', async () => {
      env.METRICS_TOKEN = 'scrape-token-0123456789';
      const a = app();
      expect((await request(a).get('/metrics')).status).toBe(401);
      expect((await request(a).get('/metrics').set('Authorization', 'Bearer nope')).status).toBe(
        401,
      );
      const ok = await request(a)
        .get('/metrics')
        .set('Authorization', 'Bearer scrape-token-0123456789');
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('# HELP');
    });

    it('serves metrics without a token when none is set', async () => {
      expect((await request(app()).get('/metrics')).status).toBe(200);
    });
  });
});

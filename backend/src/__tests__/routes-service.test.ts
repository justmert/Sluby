import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { createHealthHandler, createPrometheusHandler } from '../api/service-routes.js';
import { createApiRouter, type ApiRouterDeps } from '../api/router.js';
import { openapiDocument } from '../api/openapi.js';
import { setMetricSources, uploadSuccessTotal } from '../metrics/collector.js';
import { generateApiKey } from '../api/auth/api-key.js';
import { createTestApp } from './helpers/express-helpers.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';

const silent = pino({ level: 'silent' });

function serviceApp(log = silent) {
  const app = express();
  app.get('/health', createHealthHandler('9.9.9'));
  app.get('/metrics', createPrometheusHandler(log));
  return app;
}

afterEach(() => {
  // leave the collector without live sources for the next test
  setMetricSources({ queueDepth: async () => 0, cacheCounts: () => ({ hits: 0, misses: 0 }) });
});

describe('GET /health', () => {
  it('answers ok with the version and the current time', async () => {
    const before = Date.now();
    const res = await request(serviceApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('9.9.9');
    const ts = Date.parse(res.body.timestamp);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});

describe('GET /metrics (prometheus)', () => {
  it('serves the registry in the prometheus text format', async () => {
    uploadSuccessTotal.inc();
    setMetricSources({ queueDepth: async () => 7, cacheCounts: () => ({ hits: 1, misses: 3 }) });

    const res = await request(serviceApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(res.text).toContain('# TYPE sluby_upload_success_total counter');
    expect(res.text).toMatch(/^sluby_upload_success_total [1-9]\d*$/m);
    expect(res.text).toMatch(/^sluby_processing_queue_depth 7$/m);
    expect(res.text).toMatch(/^sluby_cache_hits_total 1$/m);
    expect(res.text).toMatch(/^sluby_cache_misses_total 3$/m);
    expect(res.text).toMatch(/^sluby_redis_up 1$/m);
    // default node process metrics are registered too
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('still answers when the queue depth source fails, with redis_up 0', async () => {
    setMetricSources({
      queueDepth: async () => {
        throw new Error('redis is down');
      },
      cacheCounts: () => ({ hits: 0, misses: 0 }),
    });

    const res = await request(serviceApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^sluby_redis_up 0$/m);
  });

  it('answers 500 and logs when collecting a metric fails', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const log = pino(
      { level: 'info' },
      new Writable({
        write(chunk, _e, cb) {
          lines.push(JSON.parse(chunk.toString()));
          cb();
        },
      }),
    );
    setMetricSources({
      queueDepth: async () => 0,
      cacheCounts: () => {
        throw new Error('cache stats unavailable');
      },
    });

    const res = await request(serviceApp(log)).get('/metrics');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to collect metrics' });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('Failed to collect metrics');
    expect((lines[0].err as { message: string }).message).toBe('cache stats unavailable');
  });
});

describe('api router public and guarded routes', () => {
  // only the key lookup is reachable from these routes; any other dependency
  // being touched would throw and fail the test
  const { key, hash } = generateApiKey();
  const tenant = generateApiKey();
  const reader = (id: string, creatorAddress: string) => ({
    id,
    name: 'reader',
    scopes: ['read'],
    rateLimit: 100,
    creatorAddress,
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
  });
  const deps = new Proxy(
    {
      findActiveSession: async () => undefined,
      markSessionSeen: () => {},
      findSession: async () => undefined,
      recordKeyUse: () => {},
      getAccount: async () => null,
      findLegacyClaim: async () => null,
      isAllowlistEntryPinned: async () => false,
      findApiKeyByHash: async (h: string) =>
        h === hash
          ? reader('k1', PLATFORM_ADDRESS)
          : h === tenant.hash
            ? reader('k2', 'acct')
            : null,
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        throw new Error(`unexpected dependency ${String(prop)}`);
      },
    },
  ) as unknown as ApiRouterDeps;

  const app = () => createTestApp(createApiRouter(deps), '/api/v1');

  it('serves the openapi document without a key', async () => {
    const res = await request(app()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(openapiDocument)));
    expect(res.body.openapi).toMatch(/^3\.1\./);
  });

  it('serves the api reference page without a key, with no script from another host', async () => {
    const res = await request(app()).get('/api/v1/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('<title>Sluby API Reference</title>');
    expect(res.text).not.toMatch(/<script[^>]+src="https?:/);
  });

  it('lets /auth/me through without a key so the studio can ask', async () => {
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not signed in', reason: 'missing' });
  });

  it('answers 404 for an unknown path without asking for a key', async () => {
    const res = await request(app()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route GET /api/v1/nope not found' });
  });

  it('keeps the json metrics, which count every tenant, from an ordinary key', async () => {
    const res = await request(app())
      .get('/api/v1/metrics')
      .set('Authorization', `Bearer ${tenant.key}`);
    expect(res.status).toBe(403);
  });

  it('guards the json metrics behind a platform key with read scope', async () => {
    const anon = await request(app()).get('/api/v1/metrics');
    expect(anon.status).toBe(401);
    expect(anon.body).toEqual({
      error: 'Missing or invalid Authorization header',
      reason: 'missing',
    });

    const bad = await request(app()).get('/api/v1/metrics').set('Authorization', 'Bearer sluby_x');
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: 'Invalid API key' });

    const ok = await request(app()).get('/api/v1/metrics').set('Authorization', `Bearer ${key}`);
    expect(ok.status).toBe(200);
    expect(Date.parse(ok.body.timestamp)).not.toBeNaN();
    const names = (ok.body.metrics as Array<{ name: string }>).map((m) => m.name);
    expect(names).toContain('sluby_upload_success_total');
    expect(ok.headers['x-ratelimit-limit']).toBe('100');
  });
});

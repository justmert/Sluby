import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { Queue } from 'bullmq';
import { QUEUE_DEPTH_TIMEOUT_MS, setMetricSources } from '../metrics/collector.js';
import { createPrometheusHandler } from '../api/service-routes.js';
import { hasTestRedis, testQueuePrefix, testRedisConnection } from './helpers/redis.js';

/**
 * A tcp proxy in front of the test Redis, so the test can take Redis away from
 * a queue that was connected, which is what stopping the Redis container does
 * to the running backend: ioredis then holds commands until it reconnects.
 */
async function startProxy(target: { host: string; port: number }) {
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect(target.port, target.host);
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('error', () => {});
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    /** Stop accepting connections and cut the open ones, like a stopped server. */
    stop: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        for (const s of sockets) s.destroy();
      }),
  };
}

describe.skipIf(!hasTestRedis)('/metrics while Redis is down (redis)', () => {
  let queue: Queue | undefined;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;

  afterEach(async () => {
    // disconnect, not close: a quit would wait for a reply that never comes
    await queue?.disconnect();
    await proxy?.stop();
    queue = proxy = undefined;
    setMetricSources({ queueDepth: async () => 0, cacheCounts: () => ({ hits: 0, misses: 0 }) });
  });

  it('answers with redis_up 0 instead of hanging', async () => {
    const { host, port } = testRedisConnection() as { host: string; port: number };
    proxy = await startProxy({ host, port });
    queue = new Queue('metrics-down', {
      connection: { host: '127.0.0.1', port: proxy.port },
      prefix: testQueuePrefix(),
    });
    queue.on('error', () => {});
    await queue.waitUntilReady();
    // the same source the backend registers
    setMetricSources({
      queueDepth: async () => {
        const c = await queue!.getJobCounts('waiting', 'active', 'delayed');
        return (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0);
      },
      cacheCounts: () => ({ hits: 0, misses: 0 }),
    });
    const app = express();
    app.get('/metrics', createPrometheusHandler(pino({ level: 'silent' })));

    const up = await request(app).get('/metrics');
    expect(up.status).toBe(200);
    expect(up.text).toMatch(/^sluby_redis_up 1$/m);
    expect(up.text).toMatch(/^sluby_processing_queue_depth 0$/m);

    await proxy.stop();

    const started = Date.now();
    const down = await request(app)
      .get('/metrics')
      .timeout(QUEUE_DEPTH_TIMEOUT_MS + 3000);
    expect(Date.now() - started).toBeLessThan(QUEUE_DEPTH_TIMEOUT_MS + 1000);
    expect(down.status).toBe(200);
    expect(down.text).toMatch(/^sluby_redis_up 0$/m);
    expect(down.text).toMatch(/^sluby_processing_queue_depth Nan$/m);
    expect(down.text).toContain('process_cpu_user_seconds_total');
  });
});

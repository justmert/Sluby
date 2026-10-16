import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, type Worker } from 'bullmq';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { hasTestRedis, testRedisConnection } from './helpers/redis.js';
import { startReceiver, answer } from './helpers/webhook-receiver.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import {
  createWebhookWorker,
  webhookJobOptions,
  WEBHOOK_QUEUE,
  type WebhookDeliveryDeps,
  type WebhookEndpointTarget,
  type WebhookJobData,
} from '../webhooks/delivery.js';
import { verifySignature } from '../webhooks/signature.js';

/**
 * The webhook queue against a real redis and a real http receiver: retries,
 * a delivery that waits out a worker restart, and one queued while no worker
 * runs. Backoff delays are shortened; the real schedule is checked in
 * webhook-delivery.test.ts.
 */
describe.skipIf(!hasTestRedis)('webhook queue (redis)', () => {
  const SECRET = 'whsec_integration';
  let prefix: string;
  let queue: Queue<WebhookJobData>;
  let workers: Worker<WebhookJobData>[];
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let respond: (n: number) => number;
  let endpoints: Map<string, WebhookEndpointTarget>;
  let recorded: Parameters<WebhookDeliveryDeps['recordDelivery']>[0][];
  let deps: WebhookDeliveryDeps;

  const openQueue = () =>
    new Queue<WebhookJobData>(WEBHOOK_QUEUE, {
      connection: testRedisConnection(),
      prefix,
      defaultJobOptions: webhookJobOptions,
    });

  const startWorker = (retryDelays: number[]) => {
    const worker = createWebhookWorker({
      connection: testRedisConnection(),
      prefix,
      deps,
      retryDelays,
    });
    workers.push(worker);
    return worker;
  };

  const dispatch = () =>
    new WebhookDispatcher({
      getActiveWebhooksForEvent: async () => [
        { ...endpoints.get('ep-1')!, events: ['asset.ready'] },
      ],
      queue,
    }).dispatch('asset.ready', { video_asset_id: 'asset-1' }, 'github:alice');

  const onlyJob = async () => {
    const jobs = await queue.getJobs(['completed', 'failed', 'delayed', 'waiting', 'active']);
    expect(jobs).toHaveLength(1);
    return jobs[0];
  };

  beforeEach(async () => {
    prefix = `sluby-test-${randomBytes(4).toString('hex')}`;
    queue = openQueue();
    workers = [];
    recorded = [];
    respond = () => 200;
    receiver = await startReceiver((n, res) => answer(res, respond(n), `answer ${n}`));
    endpoints = new Map([
      ['ep-1', { id: 'ep-1', url: receiver.url, secret: SECRET, isActive: true }],
    ]);
    deps = {
      getEndpoint: async (id) => endpoints.get(id),
      recordDelivery: async (row) => {
        recorded.push(row);
      },
    };
  });

  afterEach(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await queue.obliterate({ force: true });
    await queue.close();
    await receiver.close();
  });

  it('retries a failing receiver until it answers 2xx, with the same signed body', async () => {
    respond = (n) => (n <= 2 ? 500 : 200);
    startWorker([200, 200, 200]);

    await dispatch();
    await vi.waitFor(async () => expect(await queue.getCompletedCount()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });

    expect(receiver.requests).toHaveLength(3);
    const bodies = receiver.requests.map((r) => r.body);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toMatchObject({
      event: 'asset.ready',
      data: { video_asset_id: 'asset-1' },
    });
    for (const req of receiver.requests) {
      expect(req.headers['x-sluby-event']).toBe('asset.ready');
      expect(verifySignature(req.body, req.headers['x-sluby-signature'] as string, SECRET)).toBe(
        true,
      );
    }

    expect(recorded.map((r) => [r.statusCode, r.retryCount])).toEqual([
      [500, 0],
      [500, 1],
      [200, 2],
    ]);
    const job = await onlyJob();
    expect(job.returnvalue).toBe('delivered');
    expect(job.attemptsMade).toBe(3);
  }, 20_000);

  it('keeps a pending retry across a worker restart', async () => {
    respond = (n) => (n === 1 ? 500 : 200);
    const first = startWorker([1_500]);

    await dispatch();
    await vi.waitFor(async () => expect(await queue.getDelayedCount()).toBe(1), {
      timeout: 5_000,
      interval: 50,
    });
    expect(receiver.requests).toHaveLength(1);

    // the process goes away: its worker and queue connections close
    await first.close();
    await queue.close();

    // longer than the backoff, with nothing running to pick the job up
    await sleep(2_000);
    expect(receiver.requests).toHaveLength(1);

    queue = openQueue();
    expect(await (await onlyJob()).getState()).toBe('delayed');
    startWorker([1_500]);

    await vi.waitFor(async () => expect(await queue.getCompletedCount()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    expect(receiver.requests).toHaveLength(2);
    expect(receiver.requests[1].body).toBe(receiver.requests[0].body);
    expect(receiver.requests[1].headers['x-sluby-signature']).toBe(
      receiver.requests[0].headers['x-sluby-signature'],
    );
    expect(recorded.map((r) => [r.statusCode, r.retryCount])).toEqual([
      [500, 0],
      [200, 1],
    ]);
  }, 20_000);

  it('delivers an event queued while no worker was running', async () => {
    await dispatch();
    expect(await queue.getWaitingCount()).toBe(1);
    await sleep(200);
    expect(receiver.requests).toHaveLength(0);

    startWorker([200]);
    await vi.waitFor(async () => expect(await queue.getCompletedCount()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    expect(receiver.requests).toHaveLength(1);
  }, 20_000);

  it('drops the retry of an endpoint deleted after a failed attempt', async () => {
    respond = () => 500;
    startWorker([800]);

    await dispatch();
    await vi.waitFor(async () => expect(await queue.getDelayedCount()).toBe(1), {
      timeout: 5_000,
      interval: 50,
    });
    endpoints.delete('ep-1');

    await vi.waitFor(async () => expect(await queue.getCompletedCount()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    expect((await onlyJob()).returnvalue).toBe('skipped');
    expect(receiver.requests).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  }, 20_000);

  it('gives up after the first attempt and three retries', async () => {
    respond = () => 500;
    startWorker([50, 50, 50]);

    await dispatch();
    await vi.waitFor(async () => expect(await queue.getFailedCount()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    await sleep(300);

    expect(receiver.requests).toHaveLength(4);
    expect(recorded.map((r) => r.retryCount)).toEqual([0, 1, 2, 3]);
    const job = await onlyJob();
    expect(job.attemptsMade).toBe(4);
    expect(job.failedReason).toBe('Webhook endpoint answered 500');
  }, 20_000);
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  deliverWebhook,
  webhookBackoff,
  webhookJobOptions,
  WEBHOOK_BACKOFF_TYPE,
  WEBHOOK_RETRY_DELAYS,
  WebhookDeliveryError,
  type WebhookDeliveryDeps,
  type WebhookEndpointTarget,
  type WebhookJobData,
} from '../webhooks/delivery.js';
import { verifySignature } from '../webhooks/signature.js';
import { startReceiver, answer } from './helpers/webhook-receiver.js';

type Recorded = Parameters<WebhookDeliveryDeps['recordDelivery']>[0];

function setup(endpointUrl: string) {
  const endpoints = new Map<string, WebhookEndpointTarget>([
    ['ep-1', { id: 'ep-1', url: endpointUrl, secret: 'whsec_test', isActive: true }],
  ]);
  const recorded: Recorded[] = [];
  const deps: WebhookDeliveryDeps = {
    getEndpoint: async (id) => endpoints.get(id),
    recordDelivery: async (row) => {
      recorded.push(row);
    },
  };
  return { endpoints, recorded, deps };
}

// spacing and key order a re-serialization would not keep, so the test
// notices if the body is rebuilt instead of sent as stored
const job: WebhookJobData = {
  endpointId: 'ep-1',
  event: 'asset.ready',
  body: '{"event":"asset.ready", "timestamp":"2026-10-06T10:00:00.000Z","data":{"z":1,"a":"é"}}',
};

describe('deliverWebhook', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let respond: (n: number) => [number, string];

  beforeEach(async () => {
    respond = () => [200, 'ok'];
    receiver = await startReceiver((n, res) => {
      const [status, body] = respond(n);
      answer(res, status, body);
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await receiver.close();
  });

  it('POSTs the stored body byte for byte, signed with the endpoint secret', async () => {
    const { deps } = setup(receiver.url);

    await expect(deliverWebhook(deps, job, 0)).resolves.toBe('delivered');

    expect(receiver.requests).toHaveLength(1);
    const [req] = receiver.requests;
    expect(req.method).toBe('POST');
    expect(req.body).toBe(job.body);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-sluby-event']).toBe('asset.ready');
    const signature = req.headers['x-sluby-signature'] as string;
    expect(verifySignature(job.body, signature, 'whsec_test')).toBe(true);
    expect(verifySignature(job.body, signature, 'another-secret')).toBe(false);
  });

  it('records a 2xx attempt with its status, response and retry count', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [202, 'accepted'];

    await deliverWebhook(deps, job, 2);

    expect(recorded).toEqual([
      {
        webhookEndpointId: 'ep-1',
        eventType: 'asset.ready',
        payload: JSON.parse(job.body),
        statusCode: 202,
        responseBody: 'accepted',
        retryCount: 2,
      },
    ]);
  });

  it('records a non-2xx answer and throws so the queue retries', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [503, 'busy'];

    const err = await deliverWebhook(deps, job, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebhookDeliveryError);
    expect((err as WebhookDeliveryError).statusCode).toBe(503);
    expect(recorded).toEqual([expect.objectContaining({ statusCode: 503, responseBody: 'busy' })]);
  });

  it('counts only 2xx as delivered, not a 304', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [304, ''];

    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow(WebhookDeliveryError);
    expect(recorded[0].statusCode).toBe(304);
  });

  it('records a network error with no status and throws', async () => {
    const { deps, recorded } = setup(receiver.url);
    await receiver.close();
    receiver = await startReceiver((_n, res) => answer(res, 200));

    await expect(deliverWebhook(deps, job, 1)).rejects.toThrow(WebhookDeliveryError);
    expect(recorded).toEqual([
      expect.objectContaining({ statusCode: null, retryCount: 1, responseBody: 'fetch failed' }),
    ]);
  });

  it('keeps only the first 1000 characters of the response', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [200, 'x'.repeat(2500)];

    await deliverWebhook(deps, job, 0);
    expect(recorded[0].responseBody).toHaveLength(1000);
  });

  it('gives up on a receiver that does not answer within 10 seconds', async () => {
    const hung = await startReceiver(() => {
      // never answers
    });
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { deps, recorded } = setup(hung.url);
      const attempt = deliverWebhook(deps, job, 0).catch((e: unknown) => e);
      await hung.waitFor(1);
      vi.advanceTimersByTime(9_999);
      await Promise.resolve();
      expect(recorded).toEqual([]);
      vi.advanceTimersByTime(1);
      const err = await attempt;
      expect(err).toBeInstanceOf(WebhookDeliveryError);
      expect(recorded).toEqual([expect.objectContaining({ statusCode: null })]);
    } finally {
      await hung.close();
    }
  });

  it('calls and records nothing for a deleted or deactivated endpoint', async () => {
    const { deps, recorded, endpoints } = setup(receiver.url);

    endpoints.set('ep-1', { ...endpoints.get('ep-1')!, isActive: false });
    await expect(deliverWebhook(deps, job, 1)).resolves.toBe('skipped');

    endpoints.delete('ep-1');
    await expect(deliverWebhook(deps, job, 2)).resolves.toBe('skipped');

    expect(receiver.requests).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('stops at the next attempt when the endpoint is deleted after a failure', async () => {
    const { deps, recorded, endpoints } = setup(receiver.url);
    respond = () => [500, 'down'];

    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow(WebhookDeliveryError);
    endpoints.delete('ep-1');
    await expect(deliverWebhook(deps, job, 1)).resolves.toBe('skipped');

    expect(receiver.requests).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  it('sends the same body and signature on every attempt', async () => {
    const { deps } = setup(receiver.url);
    respond = (n) => (n < 3 ? [500, ''] : [200, '']);

    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow();
    await expect(deliverWebhook(deps, job, 1)).rejects.toThrow();
    await expect(deliverWebhook(deps, job, 2)).resolves.toBe('delivered');

    expect(new Set(receiver.requests.map((r) => r.body))).toEqual(new Set([job.body]));
    expect(new Set(receiver.requests.map((r) => r.headers['x-sluby-signature'])).size).toBe(1);
  });

  it('does not retry a delivered webhook because its row could not be written', async () => {
    const { deps } = setup(receiver.url);
    deps.recordDelivery = async () => {
      throw new Error('db down');
    };

    await expect(deliverWebhook(deps, job, 0)).resolves.toBe('delivered');

    respond = () => [500, ''];
    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow(WebhookDeliveryError);
  });
});

describe('webhook retry schedule', () => {
  it('waits 10 s, 1 min and 5 min before the retries, then stops', () => {
    const backoff = webhookBackoff();
    // bullmq passes the attempts made so far, including the one that failed
    expect([1, 2, 3].map((n) => backoff(n))).toEqual([10_000, 60_000, 300_000]);
    expect(backoff(4)).toBe(-1);
    expect(WEBHOOK_RETRY_DELAYS).toEqual([10_000, 60_000, 300_000]);
  });

  it('gives each job the first attempt plus one per delay, on the custom backoff', () => {
    expect(webhookJobOptions.attempts).toBe(4);
    expect(webhookJobOptions.backoff).toEqual({ type: WEBHOOK_BACKOFF_TYPE });
    expect(webhookJobOptions.removeOnComplete).toEqual({ count: 1000 });
    expect(webhookJobOptions.removeOnFail).toEqual({ count: 5000 });
  });

  it('uses injected delays when given', () => {
    const backoff = webhookBackoff([5, 6]);
    expect([backoff(1), backoff(2), backoff(3)]).toEqual([5, 6, -1]);
  });
});

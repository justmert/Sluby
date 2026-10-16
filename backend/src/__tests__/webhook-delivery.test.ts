import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  deliverWebhook,
  eventBody,
  webhookBackoff,
  webhookJobOptions,
  WEBHOOK_BACKOFF_TYPE,
  WEBHOOK_RETRY_DELAYS,
  WebhookDeliveryError,
  type DeliveryRecord,
  type WebhookDeliveryDeps,
  type WebhookEndpointTarget,
  type WebhookJobData,
} from '../webhooks/delivery.js';
import { parseCidrList } from '../webhooks/egress.js';
import { generateSignature, verifySignature } from '../webhooks/signature.js';
import { startReceiver, answer } from './helpers/webhook-receiver.js';

// the receivers listen on loopback, which only an operator exemption reaches
const LOOPBACK_ALLOWED = { allowedNetworks: parseCidrList('127.0.0.1/32') };

function setup(endpointUrl: string, extra: Partial<WebhookDeliveryDeps> = {}) {
  const endpoints = new Map<string, WebhookEndpointTarget>([
    ['ep-1', { id: 'ep-1', url: endpointUrl, secret: 'whsec_test', isActive: true }],
  ]);
  const recorded: DeliveryRecord[] = [];
  const deps: WebhookDeliveryDeps = {
    getEndpoint: async (id) => endpoints.get(id),
    recordDelivery: async (row) => {
      recorded.push(row);
    },
    egress: LOOPBACK_ALLOWED,
    ...extra,
  };
  return { endpoints, recorded, deps };
}

// spacing and key order a re-serialization would not keep, so the test
// notices if the body is rebuilt instead of sent as stored
const job: WebhookJobData = {
  endpointId: 'ep-1',
  event: 'asset.ready',
  body: '{"id":"evt_1","event":"asset.ready", "timestamp":"2026-10-06T10:00:00.000Z","data":{"z":1,"a":"é"}}',
  deliveryId: 'dlv_1',
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
    const before = Math.floor(Date.now() / 1000);

    await expect(deliverWebhook(deps, job, 0)).resolves.toBe('delivered');

    expect(receiver.requests).toHaveLength(1);
    const [req] = receiver.requests;
    expect(req.method).toBe('POST');
    expect(req.body).toBe(job.body);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-sluby-event']).toBe('asset.ready');
    expect(req.headers['x-sluby-delivery']).toBe('dlv_1');

    // v1: the signature binds the time it was sent
    const timestamp = req.headers['x-sluby-timestamp'] as string;
    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Number(timestamp)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    const v1 = req.headers['x-sluby-signature-v1'] as string;
    expect(verifySignature(`${timestamp}.${job.body}`, v1, 'whsec_test')).toBe(true);
    expect(verifySignature(`${Number(timestamp) + 1}.${job.body}`, v1, 'whsec_test')).toBe(false);

    // the legacy body-only signature is still sent for existing receivers
    const legacy = req.headers['x-sluby-signature'] as string;
    expect(legacy).toBe(generateSignature(job.body, 'whsec_test'));
    expect(verifySignature(job.body, legacy, 'another-secret')).toBe(false);
  });

  it('records a 2xx attempt with its status and retry count, and no response body', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [202, 'accepted'];

    await deliverWebhook(deps, job, 2);

    expect(recorded).toEqual([
      {
        webhookEndpointId: 'ep-1',
        eventType: 'asset.ready',
        payload: JSON.parse(job.body),
        statusCode: 202,
        error: null,
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
    expect(recorded).toEqual([
      expect.objectContaining({ statusCode: 503, error: 'the receiver answered 503' }),
    ]);
    expect(JSON.stringify(recorded)).not.toContain('busy');
  });

  it('counts only 2xx as delivered, not a 304', async () => {
    const { deps, recorded } = setup(receiver.url);
    respond = () => [304, ''];

    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow(WebhookDeliveryError);
    expect(recorded[0].statusCode).toBe(304);
  });

  it('records a connection failure with no status and throws', async () => {
    const { deps, recorded } = setup(receiver.url);
    await receiver.close();
    receiver = await startReceiver((_n, res) => answer(res, 200));

    await expect(deliverWebhook(deps, job, 1)).rejects.toThrow(WebhookDeliveryError);
    expect(recorded).toEqual([
      expect.objectContaining({
        statusCode: null,
        retryCount: 1,
        error: 'connection failed (ECONNREFUSED)',
      }),
    ]);
  });

  it('gives up on a receiver that does not send its status line in time', async () => {
    const hung = await startReceiver(() => {
      // never answers
    });
    try {
      const { deps, recorded } = setup(hung.url, { timeoutMs: 300 });
      const started = Date.now();
      const err = await deliverWebhook(deps, job, 0).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebhookDeliveryError);
      expect(Date.now() - started).toBeGreaterThanOrEqual(290);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(recorded).toEqual([expect.objectContaining({ statusCode: null, error: 'timed out' })]);
    } finally {
      await hung.close();
    }
  });

  it('refuses to contact a receiver on a loopback address without an exemption', async () => {
    const { deps, recorded } = setup(receiver.url, { egress: { allowedNetworks: [] } });
    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow(WebhookDeliveryError);
    expect(receiver.requests).toEqual([]);
    expect(recorded).toEqual([
      expect.objectContaining({
        statusCode: null,
        error: '127.0.0.1 resolves to an address webhooks may not reach: loopback (127.0.0.0/8)',
      }),
    ]);
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

  it('sends the same body, delivery id and legacy signature on every attempt', async () => {
    const { deps } = setup(receiver.url);
    respond = (n) => (n < 3 ? [500, ''] : [200, '']);

    await expect(deliverWebhook(deps, job, 0)).rejects.toThrow();
    await expect(deliverWebhook(deps, job, 1)).rejects.toThrow();
    await expect(deliverWebhook(deps, job, 2)).resolves.toBe('delivered');

    expect(new Set(receiver.requests.map((r) => r.body))).toEqual(new Set([job.body]));
    expect(new Set(receiver.requests.map((r) => r.headers['x-sluby-signature'])).size).toBe(1);
    expect(new Set(receiver.requests.map((r) => r.headers['x-sluby-delivery']))).toEqual(
      new Set(['dlv_1']),
    );
  });

  it('omits the delivery header for a job queued by an older version', async () => {
    const { deps } = setup(receiver.url);
    await deliverWebhook(deps, { ...job, deliveryId: undefined }, 0);
    expect(receiver.requests[0].headers['x-sluby-delivery']).toBeUndefined();
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

describe('eventBody', () => {
  it('gives every event a unique id next to the event, time and data', () => {
    const a = JSON.parse(eventBody('asset.ready', { video_asset_id: 'v1' }));
    const b = JSON.parse(eventBody('asset.ready', { video_asset_id: 'v1' }));
    expect(a).toEqual({
      id: expect.stringMatching(/^evt_[0-9a-f-]{36}$/),
      event: 'asset.ready',
      timestamp: expect.any(String),
      data: { video_asset_id: 'v1' },
    });
    expect(Date.parse(a.timestamp)).not.toBeNaN();
    expect(a.id).not.toBe(b.id);
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

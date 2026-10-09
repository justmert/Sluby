import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookEndpointManager } from './webhook-endpoints.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('WebhookEndpointManager.list()', () => {
  it('gets the endpoints and maps them', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        data: [
          {
            id: 'w1',
            url: 'https://hooks.example/a',
            events: ['asset.ready'],
            is_active: true,
            created_at: '2026-01-01T00:00:00.000Z',
            last_delivery_at: '2026-01-02T00:00:00.000Z',
            last_delivery_ok: false,
          },
        ],
      }),
    );

    const endpoints = await new WebhookEndpointManager(mockFetch).list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks', { signal: undefined });
    expect(endpoints).toEqual([
      {
        id: 'w1',
        url: 'https://hooks.example/a',
        events: ['asset.ready'],
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastDeliveryAt: '2026-01-02T00:00:00.000Z',
        lastDeliveryOk: false,
      },
    ]);
  });
});

describe('WebhookEndpointManager.create()', () => {
  it('posts the url and events and returns the secret', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'w1',
        url: 'https://hooks.example/a',
        events: ['asset.ready', 'asset.errored'],
        secret: 'shh',
      }),
    );

    const created = await new WebhookEndpointManager(mockFetch).create({
      url: 'https://hooks.example/a',
      events: ['asset.ready', 'asset.errored'],
    });

    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/v1/webhooks');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      url: 'https://hooks.example/a',
      events: ['asset.ready', 'asset.errored'],
    });
    expect(created).toEqual({
      id: 'w1',
      url: 'https://hooks.example/a',
      events: ['asset.ready', 'asset.errored'],
      secret: 'shh',
    });
  });
});

describe('WebhookEndpointManager.delete()', () => {
  it('sends DELETE to the endpoint', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

    await new WebhookEndpointManager(mockFetch).delete('w/1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w%2F1', {
      method: 'DELETE',
      signal: undefined,
    });
  });
});

describe('WebhookEndpointManager.test()', () => {
  it('posts to the test route and maps the outcome', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ delivered: false, status_code: null, error: 'connection refused' }),
    );

    const result = await new WebhookEndpointManager(mockFetch).test('w1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w1/test', {
      method: 'POST',
      signal: undefined,
    });
    expect(result).toEqual({ delivered: false, statusCode: null, error: 'connection refused' });
  });
});

describe('WebhookEndpointManager.deliveries()', () => {
  const raw = {
    id: 'd1',
    event_id: 'e1',
    event: 'asset.ready',
    status_code: 200,
    delivered: true,
    error: null,
    attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    payload: { id: 'e1', event: 'asset.ready', data: { id: 'a1' } },
    manual: true,
  };

  it('gets the attempts and maps them', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [raw] }));

    const rows = await new WebhookEndpointManager(mockFetch).deliveries('w1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w1/deliveries', {
      signal: undefined,
    });
    expect(rows).toEqual([
      {
        id: 'd1',
        eventId: 'e1',
        event: 'asset.ready',
        statusCode: 200,
        delivered: true,
        error: null,
        attempt: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        payload: { id: 'e1', event: 'asset.ready', data: { id: 'a1' } },
        manual: true,
      },
    ]);
  });

  it('sends limit and keeps a missing event id as null', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [{ ...raw, event_id: null }] }));

    const rows = await new WebhookEndpointManager(mockFetch).deliveries('w1', { limit: 5 });

    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/webhooks/w1/deliveries?limit=5');
    expect(rows[0].eventId).toBeNull();
  });
});

const RAW_ENDPOINT = {
  id: 'w1',
  url: 'https://hooks.example/a',
  events: ['asset.ready'],
  is_active: false,
  created_at: '2026-01-01T00:00:00.000Z',
  last_delivery_at: null,
  last_delivery_ok: null,
};
const ENDPOINT = {
  id: 'w1',
  url: 'https://hooks.example/a',
  events: ['asset.ready'],
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastDeliveryAt: null,
  lastDeliveryOk: null,
};

describe('WebhookEndpointManager.get()', () => {
  it('gets one endpoint and maps it', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(RAW_ENDPOINT));
    expect(await new WebhookEndpointManager(mockFetch).get('w 1')).toEqual(ENDPOINT);
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w%201', { signal: undefined });
  });
});

describe('WebhookEndpointManager.update()', () => {
  it('patches only the given fields in snake_case', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(RAW_ENDPOINT));
    const updated = await new WebhookEndpointManager(mockFetch).update('w1', { isActive: false });
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
      signal: undefined,
    });
    expect(updated).toEqual(ENDPOINT);
  });

  it('sends a new url and events', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(RAW_ENDPOINT));
    await new WebhookEndpointManager(mockFetch).update('w1', {
      url: 'https://hooks.example/b',
      events: ['asset.errored'],
    });
    expect(JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      url: 'https://hooks.example/b',
      events: ['asset.errored'],
    });
  });
});

describe('WebhookEndpointManager.rotateSecret()', () => {
  it('posts to rotate-secret and returns the new secret', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 'w1', secret: 's2' }));
    const out = await new WebhookEndpointManager(mockFetch).rotateSecret('w1');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w1/rotate-secret', {
      method: 'POST',
      signal: undefined,
    });
    expect(out).toEqual({ id: 'w1', secret: 's2' });
  });
});

describe('WebhookEndpointManager.redeliver()', () => {
  it('posts to the delivery and returns the new delivery id', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ delivery_id: 'dlv_2' }));
    const out = await new WebhookEndpointManager(mockFetch).redeliver('w1', 'd/1');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/webhooks/w1/deliveries/d%2F1/redeliver', {
      method: 'POST',
      signal: undefined,
    });
    expect(out).toEqual({ deliveryId: 'dlv_2' });
  });
});

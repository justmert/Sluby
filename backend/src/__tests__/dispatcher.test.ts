import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock signature module
vi.mock('../webhooks/signature.js', () => ({
  generateSignature: vi.fn((payload: string, secret: string) => `sig_${secret}_${payload.length}`),
}));

import { WebhookDispatcher, type WebhookDispatcherDeps, type WebhookEndpointRecord } from '../webhooks/dispatcher.js';
import { generateSignature } from '../webhooks/signature.js';
import { logger } from '../config/logger.js';

function createEndpoint(overrides: Partial<WebhookEndpointRecord> = {}): WebhookEndpointRecord {
  return {
    id: 'endpoint-1',
    url: 'https://example.com/webhook',
    events: ['upload.completed'],
    secret: 'secret-abc',
    isActive: true,
    ...overrides,
  };
}

describe('WebhookDispatcher', () => {
  let deps: WebhookDispatcherDeps;
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = {
      getActiveWebhooksForEvent: vi.fn().mockResolvedValue([]),
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    };
    dispatcher = new WebhookDispatcher(deps);

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should do nothing when no endpoints match the event', async () => {
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([]);

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(deps.getActiveWebhooksForEvent).toHaveBeenCalledWith('upload.completed');
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'upload.completed' }),
      'No webhook endpoints for event',
    );
  });

  it('should POST to matching endpoints with correct headers and body', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);

    vi.mocked(fetch).mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://example.com/webhook');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Sluby-Event': 'upload.completed',
        'X-Sluby-Signature': expect.any(String),
      }),
    );

    // Verify the body is valid JSON with correct structure
    const body = JSON.parse(options?.body as string);
    expect(body).toEqual(
      expect.objectContaining({
        event: 'upload.completed',
        timestamp: expect.any(String),
        data: { id: '123' },
      }),
    );
  });

  it('should generate a signature using the endpoint secret', async () => {
    const endpoint = createEndpoint({ secret: 'my-webhook-secret' });
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    vi.mocked(fetch).mockResolvedValue(new Response('OK', { status: 200 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(generateSignature).toHaveBeenCalledWith(
      expect.any(String), // The JSON payload
      'my-webhook-secret',
    );
  });

  it('should record successful delivery', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    vi.mocked(fetch).mockResolvedValue(new Response('OK', { status: 200 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(deps.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookEndpointId: 'endpoint-1',
        eventType: 'upload.completed',
        statusCode: 200,
        retryCount: 0,
      }),
    );
  });

  it('should record delivery on non-2xx response and schedule retry', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    vi.mocked(fetch).mockResolvedValue(new Response('Server Error', { status: 500 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(deps.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookEndpointId: 'endpoint-1',
        statusCode: 500,
        retryCount: 0,
      }),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        retryCount: 0,
      }),
      expect.stringContaining('retry'),
    );
  });

  it('should record delivery when fetch throws (network error)', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(deps.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookEndpointId: 'endpoint-1',
        statusCode: null,
        responseBody: 'Network error',
        retryCount: 0,
      }),
    );
  });

  it('should dispatch to multiple endpoints in parallel', async () => {
    const endpoint1 = createEndpoint({ id: 'ep-1', url: 'https://a.com/hook' });
    const endpoint2 = createEndpoint({ id: 'ep-2', url: 'https://b.com/hook' });
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint1, endpoint2]);
    vi.mocked(fetch).mockResolvedValue(new Response('OK', { status: 200 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    expect(fetch).toHaveBeenCalledTimes(2);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => url);
    expect(urls).toContain('https://a.com/hook');
    expect(urls).toContain('https://b.com/hook');
  });

  it('should truncate response body to 1000 chars in recorded delivery', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    const longBody = 'x'.repeat(2000);
    vi.mocked(fetch).mockResolvedValue(new Response(longBody, { status: 200 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    const recordedCall = vi.mocked(deps.recordDelivery).mock.calls[0][0];
    expect(recordedCall.responseBody!.length).toBeLessThanOrEqual(1000);
  });

  it('should handle error in one endpoint without affecting others', async () => {
    const endpoint1 = createEndpoint({ id: 'ep-1', url: 'https://fail.com/hook' });
    const endpoint2 = createEndpoint({ id: 'ep-2', url: 'https://ok.com/hook' });
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint1, endpoint2]);

    vi.mocked(fetch).mockImplementation(async (url) => {
      if ((url as string).includes('fail.com')) {
        throw new Error('Connection refused');
      }
      return new Response('OK', { status: 200 });
    });

    // Should not throw even though one endpoint fails
    await expect(dispatcher.dispatch('upload.completed', { id: '123' })).resolves.toBeUndefined();

    expect(deps.recordDelivery).toHaveBeenCalledTimes(2);
  });

  it('should include an abort signal for timeout', async () => {
    const endpoint = createEndpoint();
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([endpoint]);
    vi.mocked(fetch).mockResolvedValue(new Response('OK', { status: 200 }));

    await dispatcher.dispatch('upload.completed', { id: '123' });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});

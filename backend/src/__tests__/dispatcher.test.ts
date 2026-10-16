import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  WebhookDispatcher,
  type WebhookDispatcherDeps,
  type WebhookEndpointRecord,
} from '../webhooks/dispatcher.js';
import type { WebhookJobData } from '../webhooks/delivery.js';

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
  let added: { name: string; data: WebhookJobData; opts?: unknown }[][];
  let deps: WebhookDispatcherDeps;
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    added = [];
    deps = {
      getActiveWebhooksForEvent: vi.fn().mockResolvedValue([]),
      queue: {
        addBulk: vi.fn(async (jobs) => {
          added.push(jobs);
          return [];
        }),
      },
    };
    dispatcher = new WebhookDispatcher(deps);
  });

  it("only asks for the owning account's endpoints, and drops ownerless events", async () => {
    await dispatcher.dispatch('asset.ready', { id: 'a' }, 'github:alice');
    expect(deps.getActiveWebhooksForEvent).toHaveBeenCalledWith('asset.ready', 'github:alice');

    vi.mocked(deps.getActiveWebhooksForEvent).mockClear();
    await dispatcher.dispatch('asset.ready', { id: 'a' }, '');
    expect(deps.getActiveWebhooksForEvent).not.toHaveBeenCalled();
    expect(added).toEqual([]);
  });

  it('queues nothing when no endpoint subscribes to the event', async () => {
    await dispatcher.dispatch('upload.completed', { id: '123' }, 'github:owner');
    expect(deps.queue.addBulk).not.toHaveBeenCalled();
  });

  it('queues one job per endpoint, all with the same body and no fixed job id', async () => {
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([
      createEndpoint({ id: 'ep-1' }),
      createEndpoint({ id: 'ep-2', url: 'https://b.example/hook' }),
    ]);

    await dispatcher.dispatch('upload.completed', { id: '123' }, 'github:owner');

    expect(added).toHaveLength(1);
    const jobs = added[0];
    expect(jobs.map((j) => j.data.endpointId)).toEqual(['ep-1', 'ep-2']);
    expect(jobs.every((j) => j.name === 'upload.completed')).toBe(true);
    expect(jobs.every((j) => j.data.event === 'upload.completed')).toBe(true);
    expect(jobs.every((j) => j.opts === undefined)).toBe(true);
    expect(jobs[0].data.body).toBe(jobs[1].data.body);

    const body = JSON.parse(jobs[0].data.body);
    expect(body).toEqual({
      event: 'upload.completed',
      timestamp: expect.any(String),
      data: { id: '123' },
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    // the secret stays in postgres; the worker reads it when it sends
    expect(jobs[0].data.body).not.toContain('secret-abc');
    expect(Object.keys(jobs[0].data).sort()).toEqual(['body', 'endpointId', 'event']);
  });

  it('queues the same event twice when it is dispatched twice', async () => {
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([createEndpoint()]);
    await dispatcher.dispatch('asset.errored', { id: 'a' }, 'github:owner');
    await dispatcher.dispatch('asset.errored', { id: 'a' }, 'github:owner');
    expect(added.flat()).toHaveLength(2);
  });

  it('lets a queue failure reach the caller, which decides it is best effort', async () => {
    vi.mocked(deps.getActiveWebhooksForEvent).mockResolvedValue([createEndpoint()]);
    vi.mocked(deps.queue.addBulk).mockRejectedValue(new Error('redis down'));
    await expect(dispatcher.dispatch('asset.ready', {}, 'github:owner')).rejects.toThrow(
      'redis down',
    );
  });
});

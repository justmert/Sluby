import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as WebhookQueries from '../db/queries/webhooks.js';

describe.skipIf(!hasTestDatabase)('webhook queries (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof WebhookQueries;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/webhooks.js');
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const hook = (overrides: Partial<Parameters<typeof q.createWebhookEndpoint>[0]> = {}) =>
    q.createWebhookEndpoint({
      creatorAddress: 'alice',
      url: 'https://hooks.example/a',
      events: ['asset.ready'],
      secret: 'whsec_1',
      ...overrides,
    });

  describe('endpoints', () => {
    it('creates an active endpoint with no api key link by default', async () => {
      const h = await hook();
      expect(h).toMatchObject({ isActive: true, apiKeyId: null, events: ['asset.ready'] });
      expect((await q.getWebhookEndpointById(h.id))?.url).toBe('https://hooks.example/a');
    });

    it('lists only the owner’s active endpoints, newest first', async () => {
      const first = await hook({ url: 'https://h/1' });
      await tdb.sql`update webhook_endpoints set created_at = now() - interval '1 hour' where id = ${first.id}`;
      await hook({ url: 'https://h/2' });
      const off = await hook({ url: 'https://h/off' });
      await q.deactivateWebhookEndpoint(off.id);
      await hook({ url: 'https://h/bob', creatorAddress: 'bob' });

      expect((await q.listWebhookEndpointsByOwner('alice')).map((h) => h.url)).toEqual([
        'https://h/2',
        'https://h/1',
      ]);
      expect(
        (await q.listWebhookEndpointsByOwner('alice', { includeInactive: true }))
          .map((h) => h.url)
          .sort(),
      ).toEqual(['https://h/1', 'https://h/2', 'https://h/off']);
    });

    it('finds only the owner’s active endpoints subscribed to the event', async () => {
      await hook({ url: 'https://h/ready', events: ['asset.ready'] });
      await hook({ url: 'https://h/both', events: ['asset.failed', 'asset.ready'] });
      await hook({ url: 'https://h/failed', events: ['asset.failed'] });
      await hook({ url: 'https://h/bob', creatorAddress: 'bob', events: ['asset.ready'] });
      const off = await hook({ url: 'https://h/off', events: ['asset.ready'] });
      await q.deactivateWebhookEndpoint(off.id);
      await hook({ url: 'https://h/none', events: [] });

      const urls = (await q.findEndpointsForEvent('asset.ready', 'alice')).map((h) => h.url);
      expect(urls.sort()).toEqual(['https://h/both', 'https://h/ready']);
      expect(await q.findEndpointsForEvent('asset.ready', 'carol')).toEqual([]);
    });

    it('matches event names exactly, not by prefix or pattern', async () => {
      await hook({ events: ['asset.ready'] });
      expect(await q.findEndpointsForEvent('asset', 'alice')).toEqual([]);
      expect(await q.findEndpointsForEvent('asset.%', 'alice')).toEqual([]);
      expect(await q.findEndpointsForEvent("asset.ready'] or true --", 'alice')).toEqual([]);
    });

    it('updates url, events, secret and active state', async () => {
      const h = await hook();
      const updated = await q.updateWebhookEndpoint(h.id, {
        url: 'https://hooks.example/b',
        events: ['asset.failed'],
        secret: 'whsec_2',
        isActive: false,
      });
      expect(updated).toMatchObject({
        url: 'https://hooks.example/b',
        events: ['asset.failed'],
        secret: 'whsec_2',
        isActive: false,
      });
    });

    it('deletes only within the owner’s account, along with its deliveries', async () => {
      const h = await hook();
      await q.createWebhookDelivery({
        webhookEndpointId: h.id,
        eventType: 'asset.ready',
        payload: { id: 1 },
      });

      expect(await q.deleteWebhookEndpoint(h.id, 'bob')).toBeUndefined();
      expect(await q.getWebhookEndpointById(h.id)).toBeDefined();

      expect((await q.deleteWebhookEndpoint(h.id, 'alice'))?.id).toBe(h.id);
      expect(await q.getWebhookEndpointById(h.id)).toBeUndefined();
      const [{ n }] = await tdb.sql`select count(*)::int as n from webhook_deliveries`;
      expect(n).toBe(0);
    });
  });

  describe('deliveries', () => {
    it('records an attempt, its result and retries', async () => {
      const h = await hook();
      const d = await q.createWebhookDelivery({
        webhookEndpointId: h.id,
        eventType: 'asset.ready',
        payload: { video_asset_id: 'x', nested: { ok: true } },
      });
      expect(d).toMatchObject({ statusCode: null, deliveredAt: null, retryCount: 0 });
      expect(d.payload).toEqual({ video_asset_id: 'x', nested: { ok: true } });

      const deliveredAt = new Date('2026-05-01T10:00:00.000Z');
      const done = await q.updateWebhookDeliveryResult(d.id, { statusCode: 204, deliveredAt });
      expect(done).toMatchObject({ statusCode: 204, responseBody: null });
      expect(done!.deliveredAt!.toISOString()).toBe(deliveredAt.toISOString());

      await q.incrementDeliveryRetryCount(d.id);
      const twice = await q.incrementDeliveryRetryCount(d.id);
      expect(twice?.retryCount).toBe(2);
    });

    it('lists an endpoint’s deliveries newest first with paging', async () => {
      const h = await hook();
      const other = await hook({ url: 'https://h/other' });
      for (let i = 0; i < 4; i++) {
        const d = await q.createWebhookDelivery({
          webhookEndpointId: h.id,
          eventType: `e${i}`,
          payload: {},
        });
        await tdb.sql`update webhook_deliveries set created_at = now() - make_interval(mins => ${10 - i}) where id = ${d.id}`;
      }
      await q.createWebhookDelivery({ webhookEndpointId: other.id, eventType: 'x', payload: {} });

      const all = await q.listWebhookDeliveries({ webhookEndpointId: h.id });
      expect(all.map((d) => d.eventType)).toEqual(['e3', 'e2', 'e1', 'e0']);
      const page = await q.listWebhookDeliveries({ webhookEndpointId: h.id, limit: 2, offset: 1 });
      expect(page.map((d) => d.eventType)).toEqual(['e2', 'e1']);
    });

    it('counts deliveries by status code, with unsent ones as pending', async () => {
      const h = await hook();
      const codes = [200, 200, 500, null, null, null];
      for (const code of codes) {
        const d = await q.createWebhookDelivery({
          webhookEndpointId: h.id,
          eventType: 'asset.ready',
          payload: {},
        });
        if (code !== null) {
          await q.updateWebhookDeliveryResult(d.id, { statusCode: code, deliveredAt: new Date() });
        }
      }
      expect(await q.countDeliveriesByStatusCode(h.id)).toEqual({ '200': 2, '500': 1, pending: 3 });
    });

    it('deletes a single delivery', async () => {
      const h = await hook();
      const d = await q.createWebhookDelivery({
        webhookEndpointId: h.id,
        eventType: 'asset.ready',
        payload: {},
      });
      expect((await q.deleteWebhookDelivery(d.id))?.id).toBe(d.id);
      expect(await q.getWebhookDeliveryById(d.id)).toBeUndefined();
    });
  });
});

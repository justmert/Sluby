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

    it('lists the owner’s endpoints, paused ones too, newest first', async () => {
      const first = await hook({ url: 'https://h/1' });
      await tdb.sql`update webhook_endpoints set created_at = now() - interval '1 hour' where id = ${first.id}`;
      await hook({ url: 'https://h/2' });
      const off = await hook({ url: 'https://h/off' });
      await tdb.sql`update webhook_endpoints set is_active = false, created_at = now() - interval '2 hours' where id = ${off.id}`;
      await hook({ url: 'https://h/bob', creatorAddress: 'bob' });

      const listed = await q.listWebhookEndpointsByOwner('alice');
      expect(listed.map((h) => [h.url, h.isActive])).toEqual([
        ['https://h/2', true],
        ['https://h/1', true],
        ['https://h/off', false],
      ]);
    });

    it('reports how the newest delivery of each endpoint went', async () => {
      const quiet = await hook({ url: 'https://h/quiet' });
      const flaky = await hook({ url: 'https://h/flaky' });
      const fine = await hook({ url: 'https://h/fine' });
      const at = (ago: string) => tdb.sql`now() - ${ago}::interval`;
      const delivery = async (endpoint: string, ago: string, delivered: boolean) => {
        const d = await q.createWebhookDelivery({
          webhookEndpointId: endpoint,
          eventType: 'asset.ready',
          payload: { id: 'evt' },
          statusCode: delivered ? 200 : 500,
          deliveredAt: delivered ? new Date() : null,
        });
        await tdb.sql`update webhook_deliveries set created_at = ${at(ago)} where id = ${d.id}`;
      };
      // flaky: delivered earlier, failed last; fine: failed earlier, delivered last
      await delivery(flaky.id, '2 hours', true);
      await delivery(flaky.id, '1 hour', false);
      await delivery(fine.id, '2 hours', false);
      await delivery(fine.id, '1 hour', true);

      const byUrl = Object.fromEntries(
        (await q.listWebhookEndpointsByOwner('alice')).map((h) => [h.url, h]),
      );
      expect(byUrl['https://h/quiet']).toMatchObject({
        lastDeliveryAt: null,
        lastDeliveryOk: null,
      });
      expect(byUrl['https://h/flaky'].lastDeliveryOk).toBe(false);
      expect(byUrl['https://h/fine'].lastDeliveryOk).toBe(true);
      expect(byUrl['https://h/fine'].lastDeliveryAt).toBeInstanceOf(Date);

      const one = await q.getWebhookEndpointWithHealth(flaky.id, 'alice');
      expect(one).toMatchObject({ id: flaky.id, lastDeliveryOk: false });
      expect(await q.getWebhookEndpointWithHealth(flaky.id, 'bob')).toBeUndefined();
      expect((await q.getWebhookEndpointWithHealth(quiet.id, undefined))?.id).toBe(quiet.id);
    });

    it('lists, finds and deletes across accounts only for an undefined owner', async () => {
      const a = await hook({ url: 'https://h/alice' });
      const b = await hook({ url: 'https://h/bob', creatorAddress: 'bob' });

      expect((await q.listWebhookEndpointsByOwner(undefined)).map((h) => h.url).sort()).toEqual([
        'https://h/alice',
        'https://h/bob',
      ]);
      // an empty address is not the platform identity
      expect(await q.listWebhookEndpointsByOwner('')).toEqual([]);
      expect(await q.getWebhookEndpointForOwner(b.id, '')).toBeUndefined();
      expect((await q.getWebhookEndpointForOwner(b.id, undefined))?.id).toBe(b.id);
      expect(await q.deleteWebhookEndpoint(a.id, '')).toBeUndefined();
      expect((await q.deleteWebhookEndpoint(a.id, undefined))?.id).toBe(a.id);
    });

    it('finds only the owner’s active endpoints subscribed to the event', async () => {
      await hook({ url: 'https://h/ready', events: ['asset.ready'] });
      await hook({ url: 'https://h/both', events: ['asset.failed', 'asset.ready'] });
      await hook({ url: 'https://h/failed', events: ['asset.failed'] });
      await hook({ url: 'https://h/bob', creatorAddress: 'bob', events: ['asset.ready'] });
      const off = await hook({ url: 'https://h/off', events: ['asset.ready'] });
      await tdb.sql`update webhook_endpoints set is_active = false where id = ${off.id}`;
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
    it('records an attempt with its result', async () => {
      const h = await hook();
      const failed = await q.createWebhookDelivery({
        webhookEndpointId: h.id,
        eventType: 'asset.ready',
        payload: { video_asset_id: 'x', nested: { ok: true } },
      });
      expect(failed).toMatchObject({ statusCode: null, deliveredAt: null, retryCount: 0 });
      expect(failed.payload).toEqual({ video_asset_id: 'x', nested: { ok: true } });

      const deliveredAt = new Date('2026-05-01T10:00:00.000Z');
      const done = await q.createWebhookDelivery({
        webhookEndpointId: h.id,
        eventType: 'asset.ready',
        payload: {},
        statusCode: 204,
        deliveredAt,
        retryCount: 2,
      });
      expect(done).toMatchObject({ statusCode: 204, error: null, retryCount: 2 });
      // nothing a receiver says is kept
      expect(done).not.toHaveProperty('responseBody');
      expect(done.deliveredAt!.toISOString()).toBe(deliveredAt.toISOString());
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

    it('prunes deliveries older than the cutoff across every endpoint', async () => {
      const a = await hook();
      const b = await hook({ url: 'https://h/b', creatorAddress: 'bob' });
      for (const [endpoint, days] of [
        [a, 40],
        [a, 1],
        [b, 31],
        [b, 0],
      ] as const) {
        const d = await q.createWebhookDelivery({
          webhookEndpointId: endpoint.id,
          eventType: `${days}d`,
          payload: {},
        });
        await tdb.sql`update webhook_deliveries set created_at = now() - make_interval(days => ${days}) where id = ${d.id}`;
      }

      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      expect(await q.pruneWebhookDeliveries(cutoff)).toBe(2);
      const left = await tdb.sql`select event_type from webhook_deliveries order by event_type`;
      expect(left.map((r) => r.event_type)).toEqual(['0d', '1d']);
      expect(await q.pruneWebhookDeliveries(cutoff)).toBe(0);
    });
  });
});

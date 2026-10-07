import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as ReconciliationQueries from '../db/queries/reconciliation.js';
import type { ReconciliationSummary } from '../reconcile/reconciler.js';

describe.skipIf(!hasTestDatabase)('reconciliation inventory and runs (postgres)', () => {
  let tdb: TestDatabase;
  let recon: typeof ReconciliationQueries;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    recon = await import('../db/queries/reconciliation.js');
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const t = (iso: string) => new Date(iso);
  const ev = (id: string, deleted: boolean, iso: string) => ({ id, deleted, updatedAt: t(iso) });

  describe('indexerFeedStore', () => {
    const store = () => recon.indexerFeedStore;

    it('starts a new feed from the start and saves each page with its cursor', async () => {
      expect(await store().begin('feed-a')).toBeNull();
      const cursor = { id: 'b', after: t('2026-01-01T00:00:01Z') };
      await store().applyPage(
        'feed-a',
        [ev('a', false, '2026-01-01T00:00:00Z'), ev('b', false, '2026-01-01T00:00:01Z')],
        cursor,
      );

      expect(await store().begin('feed-a')).toEqual(cursor);
      const inv = await recon.getIndexerInventory();
      expect([...inv.keys()].sort()).toEqual(['a', 'b']);
      expect(inv.get('a')).toEqual({ deleted: false, eventAt: t('2026-01-01T00:00:00Z') });
    });

    it('keeps the latest event per object, never letting an older one overwrite it', async () => {
      await store().begin('feed-a');
      await store().applyPage(
        'feed-a',
        [ev('a', false, '2026-01-01T00:00:00Z'), ev('a', true, '2026-01-01T00:00:05Z')],
        null,
      );
      expect((await recon.getIndexerInventory()).get('a')?.deleted).toBe(true);

      // the same object read again from before the cursor
      await store().applyPage('feed-a', [ev('a', false, '2026-01-01T00:00:00Z')], null);
      expect((await recon.getIndexerInventory()).get('a')).toEqual({
        deleted: true,
        eventAt: t('2026-01-01T00:00:05Z'),
      });

      // and pinned again later
      await store().applyPage('feed-a', [ev('a', false, '2026-01-02T00:00:00Z')], null);
      expect((await recon.getIndexerInventory()).get('a')?.deleted).toBe(false);
    });

    it('drops the copy of another feed', async () => {
      await store().begin('feed-a');
      await store().applyPage('feed-a', [ev('a', false, '2026-01-01T00:00:00Z')], {
        id: 'a',
        after: t('2026-01-01T00:00:00Z'),
      });

      expect(await store().begin('feed-b')).toBeNull();
      expect((await recon.getIndexerInventory()).size).toBe(0);
      await expect(
        store().applyPage('feed-a', [ev('x', false, '2026-01-01T00:00:00Z')], null),
      ).rejects.toThrow(/no longer for feed-a/);
      expect((await recon.getIndexerInventory()).size).toBe(0);
    });

    it('forgets only deleted objects whose delete is older than the line', async () => {
      await store().begin('feed-a');
      await store().applyPage(
        'feed-a',
        [
          ev('pinned-old', false, '2026-01-01T00:00:00Z'),
          ev('deleted-old', true, '2026-01-01T00:00:00Z'),
          ev('deleted-recent', true, '2026-01-01T05:00:00Z'),
        ],
        null,
      );
      await store().pruneDeleted(t('2026-01-01T04:00:00Z'));
      expect([...(await recon.getIndexerInventory()).keys()].sort()).toEqual([
        'deleted-recent',
        'pinned-old',
      ]);
    });

    it('applies a page of the indexer’s full size in one statement', async () => {
      await store().begin('feed-a');
      const page = Array.from({ length: 500 }, (_, i) =>
        ev(`o${i}`, i % 7 === 0, '2026-01-01T00:00:00Z'),
      );
      await store().applyPage('feed-a', page, { id: 'o499', after: t('2026-01-01T00:00:00Z') });
      expect((await recon.getIndexerInventory()).size).toBe(500);
    });
  });

  describe('runs against an indexer stub', () => {
    type Event = { id: string; deleted: boolean; updatedAt: Date };
    // pages like indexd: strictly after the cursor in (updatedAt, id) order
    function stubIndexer(events: Event[]) {
      return vi.fn(async (cursor: { id: string; after: Date } | null, limit: number) =>
        [...events]
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || (a.id < b.id ? -1 : 1))
          .filter(
            (e) =>
              !cursor ||
              e.updatedAt > cursor.after ||
              (e.updatedAt.getTime() === cursor.after.getTime() && e.id > cursor.id),
          )
          .slice(0, limit),
      );
    }

    async function track(ids: string[]) {
      const [{ id }] = await tdb.sql<{ id: string }[]>`
        insert into video_assets (title, creator_address, status) values ('v', 'alice', 'ready')
        returning id
      `;
      // one statement: a row per round trip made the 600 id case time out on a loaded machine
      await tdb.sql`
        insert into artifacts (video_asset_id, role, object_id)
        select ${id}, 'rendition_data', unnest(${ids}::text[])
      `;
    }

    async function run(fetchPage: ReturnType<typeof stubIndexer>, now: Date) {
      const { runReconciliation } = await import('../reconcile/reconciler.js');
      const { syncObjectFeed } = await import('../reconcile/collect-inventory.js');
      return runReconciliation({
        getDbObjectIds: () => recon.getAllTrackedObjectIds(),
        syncIndexer: async (settledBefore) => {
          await syncObjectFeed(fetchPage, recon.indexerFeedStore, { feed: 'stub', settledBefore });
        },
        getIndexerInventory: () => recon.getIndexerInventory(),
        recordRun: (s) => recon.recordReconciliationRun(s),
        now: () => now,
      });
    }

    it('reads only what changed since the last run, and does not call work in progress drift', async () => {
      const now = new Date();
      const ago = (ms: number) => new Date(now.getTime() - ms);
      const hour = 60 * 60 * 1000;
      await track(['a', 'b']);
      const events: Event[] = [
        { id: 'a', deleted: false, updatedAt: ago(5 * hour) },
        { id: 'b', deleted: false, updatedAt: ago(4 * hour) },
        // pinned by an upload whose finalize has not run yet
        { id: 'c', deleted: false, updatedAt: ago(60_000) },
      ];
      const fetchPage = stubIndexer(events);

      const first = await run(fetchPage, now);
      expect(first).toMatchObject({ status: 'ok', inSyncCount: 2, inFlightCount: 1 });
      expect(fetchPage.mock.calls[0][0]).toBeNull();

      // a deletion unpins b and has not forgotten it yet
      events[1] = { id: 'b', deleted: true, updatedAt: new Date(now.getTime() + 1000) };
      fetchPage.mockClear();
      const second = await run(fetchPage, new Date(now.getTime() + 2000));
      expect(second).toMatchObject({ status: 'ok', inSyncCount: 1, inFlightCount: 2 });
      // resumed from the last event older than the grace window, not the start
      expect(fetchPage.mock.calls[0][0]).toEqual({ id: 'b', after: ago(4 * hour) });

      const [latest] = await tdb.sql<{ status: string }[]>`
        select status from reconciliation_runs order by finished_at desc limit 1
      `;
      expect(latest.status).toBe('ok');
    });

    it('records a failed run when the indexer’s cursor stalls', async () => {
      const at = new Date('2026-01-01T00:00:00Z');
      const ids = Array.from({ length: 600 }, (_, i) => `obj-${String(i).padStart(3, '0')}`);
      await track(ids);
      const page = ids.slice(0, 500).map((id) => ({ id, deleted: false, updatedAt: at }));
      const fetchPage = vi.fn(async () => page);

      await expect(run(fetchPage as never, new Date())).rejects.toThrow(/did not advance/);

      const [r] = await tdb.sql<{ status: string; missing_count: number; error_message: string }[]>`
        select status, missing_count, error_message from reconciliation_runs
      `;
      expect(r.status).toBe('failed');
      expect(r.missing_count).toBe(0);
      expect(r.error_message).toMatch(/did not advance/);
    });
  });

  describe('run retention', () => {
    const run = (finishedAt: Date): ReconciliationSummary => ({
      startedAt: new Date(finishedAt.getTime() - 1000),
      finishedAt,
      status: 'drift',
      dbObjectCount: 1,
      indexerObjectCount: 1,
      inSyncCount: 0,
      orphanCount: 1,
      missingCount: 1,
      orphanedIds: ['o'],
      missingIds: ['m'],
      inFlightCount: 0,
    });

    it('keeps only the latest runs', async () => {
      for (let i = 0; i < 5; i++) {
        await recon.recordReconciliationRun(run(new Date(Date.UTC(2026, 0, 1, i))), 3);
      }
      const rows = await tdb.sql<{ finished_at: Date }[]>`
        select finished_at from reconciliation_runs order by finished_at
      `;
      expect(rows.map((r) => r.finished_at.getUTCHours())).toEqual([2, 3, 4]);
      expect((await recon.getLatestReconciliationRun())?.finishedAt.getUTCHours()).toBe(4);
    });

    it('keeps 100 runs by default', async () => {
      await tdb.sql`
        insert into reconciliation_runs (started_at, finished_at, status)
        select now() - (i || ' hours')::interval, now() - (i || ' hours')::interval, 'ok'
        from generate_series(1, 150) i
      `;
      await recon.recordReconciliationRun(run(new Date()));
      const [{ n }] = await tdb.sql<
        { n: number }[]
      >`select count(*)::int as n from reconciliation_runs`;
      expect(n).toBe(100);
    });
  });
});

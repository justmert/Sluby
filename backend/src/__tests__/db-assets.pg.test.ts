import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import type * as JobQueries from '../db/queries/jobs.js';
import type * as UploadQueries from '../db/queries/uploads.js';
import type * as PlaybackIdQueries from '../db/queries/playback-ids.js';
import type { NewVideoAsset } from '../db/schema.js';

describe.skipIf(!hasTestDatabase)('asset queries (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof AssetQueries;
  let storage: typeof StorageQueries;
  let jobs: typeof JobQueries;
  let uploads: typeof UploadQueries;
  let pb: typeof PlaybackIdQueries;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/assets.js');
    storage = await import('../db/queries/storage-records.js');
    jobs = await import('../db/queries/jobs.js');
    uploads = await import('../db/queries/uploads.js');
    pb = await import('../db/queries/playback-ids.js');
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const base = Date.parse('2026-03-01T12:00:00.000Z');
  const at = (seconds: number) => new Date(base + seconds * 1000);

  function asset(overrides: Partial<NewVideoAsset> = {}) {
    return q.createVideoAsset({
      title: 'Untitled',
      creatorAddress: 'alice',
      ...overrides,
    });
  }

  describe('createVideoAsset / getVideoAssetById', () => {
    it('applies the column defaults', async () => {
      const a = await asset({ title: 'First' });
      expect(a).toMatchObject({
        title: 'First',
        description: '',
        status: 'created',
        accessTier: 'public',
        thumbnailObjectIds: [],
        siaObjectIds: [],
        segmentCount: 0,
        totalStorageBytes: 0,
        durationMs: 0,
        manifestObjectId: null,
        deletedAt: null,
      });
      expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.createdAt).toBeInstanceOf(Date);
    });

    it('scopes a lookup to the owner', async () => {
      const a = await asset({ creatorAddress: 'alice' });
      expect((await q.getVideoAssetById(a.id, 'alice'))?.id).toBe(a.id);
      expect(await q.getVideoAssetById(a.id, 'bob')).toBeUndefined();
      // internal callers pass no owner and see every tenant
      expect((await q.getVideoAssetById(a.id))?.id).toBe(a.id);
    });

    it('hides a soft-deleted asset from every lookup', async () => {
      const a = await asset();
      await q.softDeleteVideoAsset(a.id, 'alice');
      expect(await q.getVideoAssetById(a.id, 'alice')).toBeUndefined();
      expect(await q.getVideoAssetById(a.id)).toBeUndefined();
    });

    it('rejects a malformed id with the postgres error the error handler maps to 400', async () => {
      await expect(q.getVideoAssetById('not-a-uuid')).rejects.toMatchObject({ code: '22P02' });
    });

    it('stores bigint sizes and durations beyond 32 bits as numbers', async () => {
      const a = await asset({ totalStorageBytes: 5_000_000_000_123, durationMs: 9_000_000_000 });
      const read = await q.getVideoAssetById(a.id);
      expect(read?.totalStorageBytes).toBe(5_000_000_000_123);
      expect(read?.durationMs).toBe(9_000_000_000);
    });
  });

  describe('listVideoAssets', () => {
    it('lists only the owner’s assets and counts only those', async () => {
      await asset({ creatorAddress: 'alice', title: 'a1' });
      await asset({ creatorAddress: 'alice', title: 'a2' });
      await asset({ creatorAddress: 'bob', title: 'b1' });

      const alice = await q.listVideoAssets({ creatorAddress: 'alice' });
      expect(alice.total).toBe(2);
      expect(alice.data.map((a) => a.title).sort()).toEqual(['a1', 'a2']);

      const everyone = await q.listVideoAssets({});
      expect(everyone.total).toBe(3);
    });

    it('filters by status and access tier together', async () => {
      await asset({ title: 'ready-public', status: 'ready', accessTier: 'public' });
      await asset({ title: 'ready-private', status: 'ready', accessTier: 'private' });
      await asset({ title: 'failed-private', status: 'failed', accessTier: 'private' });

      const r = await q.listVideoAssets({ status: 'ready', accessTier: 'private' });
      expect(r.data.map((a) => a.title)).toEqual(['ready-private']);
      expect(r.total).toBe(1);
    });

    it('excludes soft-deleted assets from the page and the total', async () => {
      const gone = await asset({ title: 'gone' });
      await asset({ title: 'kept' });
      await q.softDeleteVideoAsset(gone.id);

      const r = await q.listVideoAssets({});
      expect(r.data.map((a) => a.title)).toEqual(['kept']);
      expect(r.total).toBe(1);
    });

    describe('search', () => {
      beforeEach(async () => {
        await asset({ title: 'Cat Video', description: 'a cat on a mat', createdAt: at(1) });
        await asset({ title: 'Dog video', description: 'no felines here', createdAt: at(2) });
        await asset({ title: 'Sale 50% off', description: '', createdAt: at(3) });
        await asset({ title: 'Sale 50 percent', description: 'snake_case', createdAt: at(4) });
      });

      const titles = async (search: string) =>
        (await q.listVideoAssets({ search })).data.map((a) => a.title);

      it('matches title or description, case-insensitively', async () => {
        expect(await titles('VIDEO')).toEqual(['Dog video', 'Cat Video']);
        expect(await titles('mat')).toEqual(['Cat Video']);
        expect(await titles('FELINE')).toEqual(['Dog video']);
      });

      it('treats LIKE wildcards in the term literally', async () => {
        expect(await titles('50%')).toEqual(['Sale 50% off']);
        expect(await titles('e_c')).toEqual(['Sale 50 percent']);
        expect(await titles('%')).toEqual(['Sale 50% off']);
        expect(await titles('_')).toEqual(['Sale 50 percent']);
      });

      it('trims the term and ignores a blank one', async () => {
        expect(await titles('  cat  ')).toEqual(['Cat Video']);
        expect((await q.listVideoAssets({ search: '   ' })).total).toBe(4);
      });

      it('finds an asset by its exact id', async () => {
        const target = await asset({ title: 'Needle', createdAt: at(5) });
        expect(await titles(target.id)).toEqual(['Needle']);
        expect(await titles(target.id.toUpperCase())).toEqual(['Needle']);
      });

      it('counts only matches in the total', async () => {
        expect((await q.listVideoAssets({ search: 'sale', limit: 1 })).total).toBe(2);
      });
    });

    describe('sorting', () => {
      beforeEach(async () => {
        await asset({ title: 'banana', durationMs: 30, totalStorageBytes: 300, createdAt: at(1) });
        await asset({ title: 'Apple', durationMs: 10, totalStorageBytes: 900, createdAt: at(2) });
        await asset({ title: 'cherry', durationMs: 20, totalStorageBytes: 100, createdAt: at(3) });
      });

      const order = async (sort: AssetQueries.AssetListOptions['sort'], dir: 'asc' | 'desc') =>
        (await q.listVideoAssets({ sort, order: dir })).data.map((a) => a.title);

      it('defaults to newest first', async () => {
        expect((await q.listVideoAssets({})).data.map((a) => a.title)).toEqual([
          'cherry',
          'Apple',
          'banana',
        ]);
      });

      it('sorts by created_at ascending', async () => {
        expect(await order('created_at', 'asc')).toEqual(['banana', 'Apple', 'cherry']);
      });

      it('sorts titles case-insensitively', async () => {
        expect(await order('title', 'asc')).toEqual(['Apple', 'banana', 'cherry']);
        expect(await order('title', 'desc')).toEqual(['cherry', 'banana', 'Apple']);
      });

      it('sorts by duration and by size', async () => {
        expect(await order('duration', 'asc')).toEqual(['Apple', 'cherry', 'banana']);
        expect(await order('size', 'desc')).toEqual(['Apple', 'banana', 'cherry']);
      });

      it('breaks ties on the sort key by id', async () => {
        await tdb.truncate();
        const made = await Promise.all(
          Array.from({ length: 5 }, () => asset({ title: 'same', durationMs: 7 })),
        );
        const ids = made.map((a) => a.id).sort();
        const asc = await q.listVideoAssets({ sort: 'duration', order: 'asc' });
        expect(asc.data.map((a) => a.id)).toEqual(ids);
        const desc = await q.listVideoAssets({ sort: 'title', order: 'desc' });
        expect(desc.data.map((a) => a.id)).toEqual([...ids].reverse());
      });

      it('pages a non-default order by offset and issues no cursor', async () => {
        const first = await q.listVideoAssets({ sort: 'title', order: 'asc', limit: 2, offset: 0 });
        expect(first.data.map((a) => a.title)).toEqual(['Apple', 'banana']);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).toBeNull();
        const second = await q.listVideoAssets({
          sort: 'title',
          order: 'asc',
          limit: 2,
          offset: 2,
        });
        expect(second.data.map((a) => a.title)).toEqual(['cherry']);
        expect(second.hasMore).toBe(false);
        expect(second.total).toBe(3);
      });

      it('ignores a cursor for a non-default order', async () => {
        const page1 = await q.listVideoAssets({ limit: 1 });
        const r = await q.listVideoAssets({
          sort: 'title',
          order: 'asc',
          cursor: page1.nextCursor!,
          limit: 10,
        });
        expect(r.data.map((a) => a.title)).toEqual(['Apple', 'banana', 'cherry']);
      });
    });

    describe('cursor pagination', () => {
      async function walk(limit: number, opts: AssetQueries.AssetListOptions = {}) {
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        for (;;) {
          const page = await q.listVideoAssets({ ...opts, limit, cursor });
          pages++;
          seen.push(...page.data.map((a) => a.id));
          expect(page.total).toBe((await q.listVideoAssets(opts)).total);
          if (!page.hasMore) {
            expect(page.nextCursor).toBeNull();
            break;
          }
          expect(page.nextCursor).toBeTruthy();
          cursor = page.nextCursor!;
          if (pages > 50) throw new Error('cursor did not terminate');
        }
        return { seen, pages };
      }

      it('walks every asset exactly once, newest first', async () => {
        const made = [];
        for (let i = 0; i < 7; i++) made.push(await asset({ title: `t${i}`, createdAt: at(i) }));

        const { seen, pages } = await walk(3);
        expect(pages).toBe(3);
        expect(seen).toEqual(made.map((a) => a.id).reverse());
      });

      it('stays exact when many assets share a timestamp', async () => {
        const made = await Promise.all(
          Array.from({ length: 9 }, (_, i) => asset({ title: `t${i}`, createdAt: at(0) })),
        );
        const { seen } = await walk(2);
        expect(seen).toEqual(
          made
            .map((a) => a.id)
            .sort()
            .reverse(),
        );
      });

      it('stays exact with sub-millisecond timestamps the cursor cannot carry', async () => {
        const made = [];
        for (let i = 0; i < 6; i++) made.push(await asset({ title: `t${i}` }));
        // postgres keeps microseconds; js dates (and so cursors) keep only
        // milliseconds. put several rows inside the same millisecond.
        const micros = ['000100', '000900', '000500', '999999', '123456', '000001'];
        for (let i = 0; i < made.length; i++) {
          await tdb.sql`
            update video_assets
            set created_at = ${`2026-03-01 12:00:00.${micros[i]}+00`}::timestamptz
            where id = ${made[i].id}
          `;
        }
        const expected = await tdb.sql<{ id: string }[]>`
          select id from video_assets
          order by date_trunc('milliseconds', created_at) desc, id desc
        `;
        const { seen } = await walk(1);
        expect(seen).toEqual(expected.map((r) => r.id));
        expect(new Set(seen).size).toBe(6);
      });

      it('applies filters to every page', async () => {
        for (let i = 0; i < 6; i++) {
          await asset({
            title: `t${i}`,
            creatorAddress: i % 2 ? 'alice' : 'bob',
            createdAt: at(i),
          });
        }
        const { seen } = await walk(2, { creatorAddress: 'alice' });
        expect(seen).toHaveLength(3);
        const owners = await tdb.sql<{ creator_address: string }[]>`
          select creator_address from video_assets where id = any(${seen}::uuid[])
        `;
        expect(owners.every((o) => o.creator_address === 'alice')).toBe(true);
      });

      it('does not skip or repeat rows inserted between pages', async () => {
        for (let i = 0; i < 4; i++) await asset({ title: `old${i}`, createdAt: at(i) });
        const page1 = await q.listVideoAssets({ limit: 2 });
        expect(page1.data.map((a) => a.title)).toEqual(['old3', 'old2']);

        // a newer upload lands while the client is paging
        await asset({ title: 'new', createdAt: at(100) });

        const page2 = await q.listVideoAssets({ limit: 2, cursor: page1.nextCursor! });
        expect(page2.data.map((a) => a.title)).toEqual(['old1', 'old0']);
        expect(page2.hasMore).toBe(false);
        expect(page2.total).toBe(5);
      });

      it('starts from the beginning on a malformed cursor', async () => {
        for (let i = 0; i < 3; i++) await asset({ title: `t${i}`, createdAt: at(i) });
        const r = await q.listVideoAssets({ cursor: 'garbage!!', limit: 10 });
        expect(r.data.map((a) => a.title)).toEqual(['t2', 't1', 't0']);
      });

      it('reports no more pages on an exact fit', async () => {
        for (let i = 0; i < 4; i++) await asset({ title: `t${i}`, createdAt: at(i) });
        const r = await q.listVideoAssets({ limit: 4 });
        expect(r.hasMore).toBe(false);
        expect(r.nextCursor).toBeNull();
      });
    });
  });

  describe('updateVideoAsset', () => {
    it('updates only the owner’s asset and bumps updatedAt', async () => {
      const a = await asset({ createdAt: at(0) });
      expect(await q.updateVideoAsset(a.id, { title: 'stolen' }, 'bob')).toBeUndefined();
      expect((await q.getVideoAssetById(a.id))?.title).toBe('Untitled');

      const updated = await q.updateVideoAsset(
        a.id,
        { title: 'renamed', accessTier: 'private' },
        'alice',
      );
      expect(updated).toMatchObject({ title: 'renamed', accessTier: 'private' });
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(a.updatedAt.getTime());
    });

    it('returns undefined for an unknown id', async () => {
      expect(
        await q.updateVideoAsset('00000000-0000-4000-8000-000000000000', { title: 'x' }),
      ).toBeUndefined();
    });
  });

  describe('deletion', () => {
    it('soft-deletes once, then reports nothing to delete', async () => {
      const a = await asset();
      const first = await q.softDeleteVideoAsset(a.id, 'alice');
      expect(first?.deletedAt).toBeInstanceOf(Date);
      expect(await q.softDeleteVideoAsset(a.id, 'alice')).toBeUndefined();
      expect(await q.softDeleteVideoAsset(a.id)).toBeUndefined();
    });

    it('will not soft-delete another owner’s asset', async () => {
      const a = await asset({ creatorAddress: 'alice' });
      expect(await q.softDeleteVideoAsset(a.id, 'bob')).toBeUndefined();
      expect(await q.getVideoAssetById(a.id, 'alice')).toBeDefined();
    });

    it('collects every object id once, including from a soft-deleted asset', async () => {
      const a = await asset({
        manifestObjectId: 'master',
        thumbnailObjectIds: ['thumb1', 'thumb2'],
        siaObjectIds: ['legacy', 'master'],
      });
      await storage.persistStorageRecords(a.id, {
        renditions: [
          {
            name: '360p',
            width: 640,
            height: 360,
            videoBitrateKbps: 800,
            segmentCount: 2,
            byteSize: 10,
            dataObjectId: 'data360',
            playlistObjectId: 'pl360',
          },
        ],
        artifacts: [
          { role: 'rendition_data', objectId: 'data360', byteSize: 10, renditionName: '360p' },
          { role: 'variant_playlist', objectId: 'pl360', byteSize: 1, renditionName: '360p' },
          { role: 'master_manifest', objectId: 'master', byteSize: 1, renditionName: null },
          { role: 'thumbnail', objectId: 'thumb1', byteSize: 1, renditionName: null },
        ],
      });
      await q.softDeleteVideoAsset(a.id);

      const ids = await q.getAssetObjectIds(a.id);
      expect([...ids].sort()).toEqual(['data360', 'legacy', 'master', 'pl360', 'thumb1', 'thumb2']);
    });

    it('forgets unpinned objects so a retried deletion only sees the rest', async () => {
      const a = await asset({
        manifestObjectId: 'master',
        thumbnailObjectIds: ['thumb1', 'thumb2'],
        siaObjectIds: ['legacy'],
      });
      await storage.persistStorageRecords(a.id, {
        renditions: [],
        artifacts: [
          { role: 'master_manifest', objectId: 'master', byteSize: 1, renditionName: null },
          { role: 'thumbnail', objectId: 'thumb1', byteSize: 1, renditionName: null },
          { role: 'thumbnail', objectId: 'thumb2', byteSize: 1, renditionName: null },
        ],
      });
      await q.softDeleteVideoAsset(a.id);

      await q.markObjectsUnpinned(a.id, ['master', 'thumb1', 'legacy']);
      expect(await q.getAssetObjectIds(a.id)).toEqual(['thumb2']);
      const row = (await tdb.sql`select * from video_assets where id = ${a.id}`)[0];
      expect(row.manifest_object_id).toBeNull();
      expect(row.thumbnail_object_ids).toEqual(['thumb2']);
      expect(row.sia_object_ids).toEqual([]);

      await q.markObjectsUnpinned(a.id, ['thumb2']);
      expect(await q.getAssetObjectIds(a.id)).toEqual([]);
    });

    it('treats an empty unpin list as a no-op', async () => {
      const a = await asset({ manifestObjectId: 'm' });
      await q.markObjectsUnpinned(a.id, []);
      expect(await q.getAssetObjectIds(a.id)).toEqual(['m']);
    });

    it('lists only assets soft-deleted longer ago than the cutoff', async () => {
      const old = await asset({ title: 'old' });
      const recent = await asset({ title: 'recent' });
      await asset({ title: 'live' });
      await q.softDeleteVideoAsset(old.id);
      await q.softDeleteVideoAsset(recent.id);
      await tdb.sql`update video_assets set deleted_at = now() - interval '2 hours' where id = ${old.id}`;

      const pending = await q.listAssetsPendingDeletion(60 * 60 * 1000);
      expect(pending).toEqual([{ id: old.id }]);
    });

    it('hard delete removes the row and cascades to everything that hangs off it', async () => {
      const a = await asset({ creatorAddress: 'alice' });
      const session = await uploads.createUploadSession({
        uploadUrl: 'http://x/u',
        filePath: '/tmp/x',
        fileSize: 10,
        videoAssetId: a.id,
      });
      await jobs.createProcessingJob({ videoAssetId: a.id, uploadSessionId: session.id });
      await pb.createPlaybackIdForAsset(a.id, {}, 'alice');
      await storage.persistStorageRecords(a.id, {
        renditions: [
          {
            name: '360p',
            width: 640,
            height: 360,
            videoBitrateKbps: 800,
            segmentCount: 1,
            byteSize: 1,
            dataObjectId: 'd',
            playlistObjectId: 'p',
          },
        ],
        artifacts: [{ role: 'rendition_data', objectId: 'd', byteSize: 1, renditionName: '360p' }],
      });

      expect(await q.deleteVideoAsset(a.id, 'bob')).toBeUndefined();
      expect((await q.deleteVideoAsset(a.id, 'alice'))?.id).toBe(a.id);

      const counts = await tdb.sql<{ t: string; n: number }[]>`
        select 'assets' as t, count(*)::int as n from video_assets
        union all select 'renditions', count(*)::int from renditions
        union all select 'artifacts', count(*)::int from artifacts
        union all select 'jobs', count(*)::int from processing_jobs
        union all select 'playback', count(*)::int from playback_ids
      `;
      expect(Object.fromEntries(counts.map((c) => [c.t, c.n]))).toEqual({
        assets: 0,
        renditions: 0,
        artifacts: 0,
        jobs: 0,
        playback: 0,
      });
      // the upload session outlives the asset with its link cleared
      expect((await uploads.getUploadSessionById(session.id))?.videoAssetId).toBeNull();
    });
  });
});

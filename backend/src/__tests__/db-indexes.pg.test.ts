import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as Pagination from '../api/pagination.js';
import type { db as Db } from '../config/database.js';

// plans are read with sorts and sequential scans priced out, so a sort or a
// seq scan left in a plan means no index can serve the query at all
async function plan(tdb: TestDatabase, query: string, params: unknown[] = []): Promise<string> {
  const lines = await tdb.sql.begin(async (tx) => {
    await tx`set local enable_sort = off`;
    await tx`set local enable_seqscan = off`;
    return tx.unsafe(`explain ${query}`, params as never[]);
  });
  return lines.map((l) => (l as Record<string, string>)['QUERY PLAN']).join('\n');
}

describe.skipIf(!hasTestDatabase)('indexes behind hot queries (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof AssetQueries;
  let pagination: typeof Pagination;
  let db: typeof Db;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/assets.js');
    pagination = await import('../api/pagination.js');
    ({ db, closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  it('covers every foreign key with an index that leads with its columns', async () => {
    const uncovered = await tdb.sql<{ fk: string }[]>`
      select c.conrelid::regclass || '(' || string_agg(a.attname, ', ' order by k.n) || ')' as fk
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality k(attnum, n)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )
      group by c.oid, c.conrelid
    `;
    expect(uncovered.map((r) => r.fk)).toEqual([]);
  });

  describe('asset listing', () => {
    const cursor = () =>
      pagination.encodeCursor({
        createdAt: new Date('2026-03-01T12:00:00.123Z'),
        id: '0b7a3f5e-8f3c-4c2a-9d39-0e1f5a6b7c8d',
      });

    async function listingPlan(opts: AssetQueries.AssetListOptions) {
      const { dataWhere, orderBy } = q.assetListQuery(opts);
      const built = db.query.videoAssets.findMany({ where: dataWhere, limit: 21, orderBy }).toSQL();
      return plan(tdb, built.sql, built.params);
    }

    it('reads the platform listing in index order, first page and cursor page', async () => {
      for (const opts of [{}, { cursor: cursor() }]) {
        const p = await listingPlan(opts);
        expect(p).not.toMatch(/\bSort\b/);
        expect(p).toContain('video_assets_created_at_id_idx');
      }
    });

    it('reads a tenant listing from its own index, first page and cursor page', async () => {
      for (const opts of [
        { creatorAddress: 'alice' },
        { creatorAddress: 'alice', cursor: cursor() },
      ]) {
        const p = await listingPlan(opts);
        expect(p).not.toMatch(/\bSort\b/);
        expect(p).toContain('video_assets_owner_listing_idx');
      }
    });

    it('stores created_at at millisecond precision, whatever it is written with', async () => {
      const a = await q.createVideoAsset({ title: 't', creatorAddress: 'alice' });
      await tdb.sql`
        insert into video_assets (title, creator_address, created_at)
        values ('micro', 'alice', '2026-03-01 12:00:00.123456+00')
      `;
      const rows = await tdb.sql<{ id: string; exact: boolean; created_at: Date }[]>`
        select id, created_at, created_at = date_trunc('milliseconds', created_at) as exact
        from video_assets
      `;
      expect(rows.every((r) => r.exact)).toBe(true);
      // the row read back is exactly what a cursor built from it carries
      const read = await q.getVideoAssetById(a.id);
      const stored = rows.find((r) => r.id === a.id)!;
      expect(read!.createdAt.getTime()).toBe(stored.created_at.getTime());
    });
  });

  it('finds an asset’s upload sessions and the sweep’s paths by index', async () => {
    const byAsset = await plan(
      tdb,
      `select file_path from upload_sessions where video_asset_id = $1 and status <> 'cancelled'`,
      ['0b7a3f5e-8f3c-4c2a-9d39-0e1f5a6b7c8d'],
    );
    expect(byAsset).not.toContain('Seq Scan');
    const byPath = await plan(
      tdb,
      `select us.file_path from upload_sessions us
         left join video_assets va on va.id = us.video_asset_id
        where us.file_path in ($1, $2)`,
      ['/data/uploads/a', '/data/uploads/b'],
    );
    expect(byPath).not.toContain('Seq Scan on upload_sessions');
  });

  it('lists an endpoint’s deliveries newest first from an index', async () => {
    const p = await plan(
      tdb,
      `select * from webhook_deliveries where webhook_endpoint_id = $1 order by created_at desc limit 50`,
      ['0b7a3f5e-8f3c-4c2a-9d39-0e1f5a6b7c8d'],
    );
    expect(p).not.toContain('Seq Scan');
    expect(p).not.toMatch(/\bSort\b/);
  });
});

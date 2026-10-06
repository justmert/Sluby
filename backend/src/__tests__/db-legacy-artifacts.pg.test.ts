import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';

// a database at the last migration before the backfill, filled the way older
// versions wrote it, then upgraded
describe.skipIf(!hasTestDatabase)('legacy object ids backfilled into artifacts (postgres)', () => {
  let tdb: TestDatabase;
  let closeDatabase: (() => Promise<void>) | undefined;

  const legacy = '00000000-0000-4000-8000-00000000000a';
  const current = '00000000-0000-4000-8000-00000000000b';
  const deleting = '00000000-0000-4000-8000-00000000000c';
  const empty = '00000000-0000-4000-8000-00000000000d';

  beforeAll(async () => {
    tdb = await createTestDatabase({ through: '0008_listing_and_foreign_key_indexes' });
    const sql = tdb.sql;

    // stored before artifacts existed: ids only on the asset row, the master
    // and thumbnails also inside sia_object_ids as finalize wrote them
    await sql`
      insert into video_assets (id, title, creator_address, status, manifest_object_id,
        thumbnail_object_ids, sia_object_ids, total_storage_bytes, created_at)
      values (${legacy}, 'legacy', 'alice', 'ready', 'm-legacy', ${['t-legacy-1', 't-legacy-2']},
        ${sql.json(['d-legacy', 'p-legacy', 't-legacy-1', 't-legacy-2', 'm-legacy'])}, 500,
        '2026-05-01T00:00:00Z')
    `;
    // a current asset: every id already has its artifact row
    await sql`
      insert into video_assets (id, title, creator_address, status, manifest_object_id,
        thumbnail_object_ids, sia_object_ids, total_storage_bytes)
      values (${current}, 'current', 'alice', 'ready', 'm-current', ${['t-current']},
        ${sql.json(['d-current', 't-current', 'm-current'])}, 300)
    `;
    await sql`
      insert into artifacts (video_asset_id, role, object_id, byte_size)
      values (${current}, 'master_manifest', 'm-current', 10),
             (${current}, 'thumbnail', 't-current', 20),
             (${current}, 'rendition_data', 'd-current', 270)
    `;
    // being deleted, its objects not unpinned yet: deletion still needs them
    await sql`
      insert into video_assets (id, title, creator_address, status, manifest_object_id,
        thumbnail_object_ids, sia_object_ids, deleted_at)
      values (${deleting}, 'deleting', 'bob', 'ready', 'm-deleting', '{}',
        ${sql.json(['m-deleting', 'd-deleting'])}, now())
    `;
    // nothing stored, plus the blank values older rows can hold
    await sql`
      insert into video_assets (id, title, creator_address, manifest_object_id,
        thumbnail_object_ids, sia_object_ids)
      values (${empty}, 'empty', 'bob', '', ${['']}, ${sql.json([''])})
    `;

    await tdb.migrateToLatest();
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  const rows = (asset: string) =>
    tdb.sql<{ object_id: string; role: string | null; rendition_id: string | null }[]>`
      select object_id, role, rendition_id from artifacts
      where video_asset_id = ${asset} order by object_id
    `;

  it('records each legacy id once, with the role the columns tell', async () => {
    expect(await rows(legacy)).toEqual([
      { object_id: 'd-legacy', role: null, rendition_id: null },
      { object_id: 'm-legacy', role: 'master_manifest', rendition_id: null },
      { object_id: 'p-legacy', role: null, rendition_id: null },
      { object_id: 't-legacy-1', role: 'thumbnail', rendition_id: null },
      { object_id: 't-legacy-2', role: 'thumbnail', rendition_id: null },
    ]);
  });

  it('dates the rows by their asset, not by the upgrade', async () => {
    const [r] = await tdb.sql<{ created_at: Date }[]>`
      select min(created_at) as created_at from artifacts where video_asset_id = ${legacy}
    `;
    expect(r.created_at.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('leaves assets that already had their artifacts alone', async () => {
    expect((await rows(current)).map((r) => [r.object_id, r.role])).toEqual([
      ['d-current', 'rendition_data'],
      ['m-current', 'master_manifest'],
      ['t-current', 'thumbnail'],
    ]);
  });

  it('covers assets mid-deletion and skips blank ids', async () => {
    expect((await rows(deleting)).map((r) => r.object_id)).toEqual(['d-deleting', 'm-deleting']);
    expect(await rows(empty)).toEqual([]);
  });

  it('leaves no id on an asset row without its artifact row', async () => {
    const [{ n }] = await tdb.sql<{ n: number }[]>`
      select count(*)::int as n
      from video_assets v
      cross join lateral (
        select v.manifest_object_id as id
        union select unnest(v.thumbnail_object_ids)
        union select jsonb_array_elements_text(v.sia_object_ids)
          where jsonb_typeof(v.sia_object_ids) = 'array'
      ) ids
      where ids.id is not null and ids.id <> ''
        and not exists (
          select 1 from artifacts a where a.video_asset_id = v.id and a.object_id = ids.id
        )
    `;
    expect(n).toBe(0);
  });

  it('counts legacy objects in the library stats', async () => {
    const { getAssetStats } = await import('../db/queries/stats.js');
    const alice = await getAssetStats('alice');
    // 5 legacy objects and 3 current ones; the deleting asset is bob's and hidden
    expect(alice.objectCount).toBe(8);
  });
});

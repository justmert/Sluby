import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql as dsql } from 'drizzle-orm';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AccessControl from '../delivery/access-control.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import { buildStorageRecords } from '../storage/artifact-records.js';
import type * as Database from '../config/database.js';

// the gateway's access decision for an object, on a real database: which
// assets claim an object id, and what their tier, deletion and signing state
// say about serving it
describe.skipIf(!hasTestDatabase)('delivery access per object (postgres)', () => {
  let tdb: TestDatabase;
  let access: typeof AccessControl;
  let assets: typeof AssetQueries;
  let storage: typeof StorageQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    access = await import('../delivery/access-control.js');
    assets = await import('../db/queries/assets.js');
    storage = await import('../db/queries/storage-records.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  let n = 0;
  const oid = () => `${(++n).toString(16).padStart(8, '0')}`.padEnd(64, 'e');

  beforeEach(async () => {
    await tdb.truncate();
  });

  async function assetWith(
    objectIds: string[],
    fields: { tier?: 'public' | 'private'; deleted?: boolean; owner?: string } = {},
  ): Promise<string> {
    const [row] = await tdb.sql<{ id: string }[]>`
      insert into video_assets (title, creator_address, status, access_tier, deleted_at)
      values ('a', ${fields.owner ?? 'alice'}, 'ready', ${fields.tier ?? 'public'},
        ${fields.deleted ? new Date() : null})
      returning id
    `;
    for (const objectId of objectIds) {
      await tdb.sql`
        insert into artifacts (video_asset_id, role, object_id)
        values (${row.id}, 'rendition_data', ${objectId})
      `;
    }
    return row.id;
  }

  it('serves an object of a public asset, and asks for a signature on a private one', async () => {
    const pub = oid();
    const priv = oid();
    const pubAsset = await assetWith([pub]);
    const privAsset = await assetWith([priv], { tier: 'private' });

    expect(await access.resolveObjectAccess(pub)).toEqual({
      kind: 'public',
      assetId: pubAsset,
      isMaster: false,
    });
    expect(await access.resolveObjectAccess(priv)).toEqual({
      kind: 'private',
      assetId: privAsset,
      signing: { generation: 0, legacyUntilSec: null },
      isMaster: false,
    });
  });

  it('refuses an id no asset claims, and an asset being deleted', async () => {
    const gone = oid();
    await assetWith([gone], { deleted: true });
    expect(await access.resolveObjectAccess(oid())).toEqual({ kind: 'unknown' });
    expect(await access.resolveObjectAccess(gone)).toEqual({ kind: 'gone' });
  });

  it('ignores signed playback ids: objects follow only the asset tier', async () => {
    const id = oid();
    const asset = await assetWith([id]);
    await tdb.sql`
      insert into playback_ids (playback_id, video_asset_id, policy)
      values ('pb_signedsignedsignedsign', ${asset}, 'signed')
    `;
    expect(await access.resolveObjectAccess(id)).toEqual({
      kind: 'public',
      assetId: asset,
      isMaster: false,
    });
  });

  it('picks the strictest claim when two assets hold one object', async () => {
    const shared = oid();
    await assetWith([shared]);
    const priv = await assetWith([shared], { tier: 'private' });
    expect(await access.resolveObjectAccess(shared)).toMatchObject({
      kind: 'private',
      assetId: priv,
    });

    const both = oid();
    await assetWith([both]);
    await assetWith([both], { deleted: true });
    expect(await access.resolveObjectAccess(both)).toEqual({ kind: 'gone' });
  });

  it('sees a tier edit, a revoke and a delete at once after invalidation', async () => {
    const id = oid();
    const asset = await assetWith([id]);
    expect((await access.resolveObjectAccess(id)).kind).toBe('public');

    // without invalidation the cached state is used for up to a minute
    await tdb.sql`update video_assets set access_tier = 'private' where id = ${asset}`;
    expect((await access.resolveObjectAccess(id)).kind).toBe('public');

    access.invalidateAssetAccess(asset);
    expect(await access.resolveObjectAccess(id)).toMatchObject({ kind: 'private' });

    const generation = await assets.raiseSigningGeneration(asset);
    expect(generation).toBe(1);
    access.invalidateAssetAccess(asset);
    expect(await access.resolveObjectAccess(id)).toMatchObject({
      signing: { generation: 1, legacyUntilSec: null },
    });

    await assets.softDeleteVideoAsset(asset);
    access.invalidateAssetAccess(asset);
    expect(await access.resolveObjectAccess(id)).toEqual({ kind: 'gone' });

    // and once the row is gone for good
    await tdb.sql`delete from video_assets where id = ${asset}`;
    access.invalidateAssetAccess(asset);
    expect(await access.resolveObjectAccess(id)).toEqual({ kind: 'unknown' });
  });

  it('raises the signing generation when the tier changes, and only then', async () => {
    const asset = await assetWith([oid()]);
    await tdb.sql`
      update video_assets set legacy_signatures_until = now() + interval '1 hour'
      where id = ${asset}
    `;
    const same = await assets.updateAssetMetadata(asset, { accessTier: 'public', title: 'x' });
    expect(same?.signingGeneration).toBe(0);
    expect(same?.legacySignaturesUntil).not.toBeNull();

    const flipped = await assets.updateAssetMetadata(asset, { accessTier: 'private' });
    expect(flipped?.accessTier).toBe('private');
    expect(flipped?.signingGeneration).toBe(1);
    expect(flipped?.legacySignaturesUntil).toBeNull();

    const back = await assets.updateAssetMetadata(asset, { accessTier: 'public' });
    expect(back?.signingGeneration).toBe(2);
    const titleOnly = await assets.updateAssetMetadata(asset, { title: 'y' });
    expect(titleOnly?.signingGeneration).toBe(2);
  });

  it('revokes only for the owner and only a live asset', async () => {
    const asset = await assetWith([oid()], { owner: 'alice' });
    expect(await assets.raiseSigningGeneration(asset, 'bob')).toBeUndefined();
    expect(await assets.raiseSigningGeneration(asset, 'alice')).toBe(1);
    await assets.softDeleteVideoAsset(asset);
    expect(await assets.raiseSigningGeneration(asset)).toBeUndefined();
  });

  // the pipeline only writes artifacts in finalize, from the run's pending
  // objects, and the tier lookup reads nothing else
  it('serves every object of an asset finalize just made ready, and none before', async () => {
    const a = await assets.createVideoAsset({ title: 'v', creatorAddress: 'alice' });
    await assets.updateVideoAsset(a.id, { status: 'processing' });
    const [data, playlist, thumb, master, early] = [oid(), oid(), oid(), oid(), oid()];
    await storage.recordUploadingObjects(a.id, 'initial', [data, playlist, thumb, master, early]);

    // pinned and pending is not a claim
    expect(await access.resolveObjectAccess(early)).toEqual({ kind: 'unknown' });

    const records = buildStorageRecords({
      variants: [
        {
          name: '360p',
          width: 640,
          height: 360,
          videoBitrateKbps: 900,
          segmentCount: 2,
          dataObjectId: data,
          dataByteSize: 1000,
          playlistObjectId: playlist,
          playlistByteSize: 100,
        },
      ],
      thumbnails: [{ objectId: thumb, byteSize: 10 }],
      master: { objectId: master, byteSize: 50 },
    });
    const done = await storage.finalizeAssetStorage(a.id, {
      records,
      manifestObjectId: master,
      thumbnailObjectIds: [thumb],
      siaObjectIds: [data, playlist, thumb, master],
      durationMs: 4000,
      resolution: '640x360',
      segmentCount: 2,
      totalStorageBytes: 1160,
    });
    expect(done.outcome).toBe('ready');

    for (const id of [master, playlist, data, thumb]) {
      // the master is where a play starts, so the gateway counts it there
      expect(await access.resolveObjectAccess(id)).toEqual({
        kind: 'public',
        assetId: a.id,
        isMaster: id === master,
      });
    }

    // made private after it went ready: the poster needs a signature too
    const flipped = await assets.updateAssetMetadata(a.id, { accessTier: 'private' });
    access.invalidateAssetAccess(a.id);
    expect(await access.resolveObjectAccess(thumb)).toEqual({
      kind: 'private',
      assetId: a.id,
      signing: { generation: flipped?.signingGeneration, legacyUntilSec: null },
      isMaster: false,
    });
  });

  it('finds the owners through the artifacts index, never a scan of the assets', async () => {
    await assetWith([oid()]);
    // on one connection: a seq scan may only win if no index can serve the query
    const plan = await database.db.transaction(async (tx) => {
      await tx.execute(dsql`set local enable_seqscan = off`);
      return (await tx.execute(
        dsql`explain ${access.objectOwnersQuery(oid())}`,
      )) as unknown as Array<{ 'QUERY PLAN': string }>;
    });
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('artifacts_object_id_idx');
    expect(text).not.toMatch(/Seq Scan/);
  });
});

// migration 0014 on a database that already holds assets
describe.skipIf(!hasTestDatabase)('signing generation migration (postgres)', () => {
  let tdb: TestDatabase;
  let closeDatabase: (() => Promise<void>) | undefined;
  const existing = '00000000-0000-4000-8000-0000000000e1';

  beforeAll(async () => {
    tdb = await createTestDatabase({ through: '0013_pending_objects' });
    await tdb.sql`
      insert into video_assets (id, title, creator_address, status, access_tier)
      values (${existing}, 'before', 'alice', 'ready', 'private')
    `;
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  it('opens a six-hour window for urls signed before, on existing rows only, without rewriting the table', async () => {
    const before = await tdb.sql<{ node: string }[]>`
      select pg_relation_filenode('video_assets')::text as node
    `;
    const startedAt = Date.now();
    await tdb.migrateToLatest();

    const after = await tdb.sql<{ node: string }[]>`
      select pg_relation_filenode('video_assets')::text as node
    `;
    expect(after[0].node).toBe(before[0].node);

    const [old] = await tdb.sql<{ g: number; until: Date }[]>`
      select signing_generation as g, legacy_signatures_until as until
      from video_assets where id = ${existing}
    `;
    expect(old.g).toBe(0);
    const windowMs = old.until.getTime() - startedAt;
    expect(windowMs).toBeGreaterThan(6 * 3600_000 - 60_000);
    expect(windowMs).toBeLessThanOrEqual(6 * 3600_000 + 60_000);

    await tdb.sql`
      insert into video_assets (title, creator_address) values ('after', 'alice')
    `;
    const [fresh] = await tdb.sql<{ g: number; until: Date | null }[]>`
      select signing_generation as g, legacy_signatures_until as until
      from video_assets where title = 'after'
    `;
    expect(fresh).toEqual({ g: 0, until: null });
  });
});

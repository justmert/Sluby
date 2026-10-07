import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import pino from 'pino';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';

const fake = await vi.hoisted(async () => (await import('./helpers/fake-sia.js')).createFakeSia());
vi.mock('@siafoundation/sia-storage', () => fake.module);

type Assets = typeof import('../db/queries/assets.js');
type Storage = typeof import('../db/queries/storage-records.js');

/**
 * A deletion with the real queries and sia client, against a fake indexer
 * that answers 404 for objects it does not have, as sia.storage does.
 */
describe.skipIf(!hasTestDatabase)('asset deletion against the indexer (postgres)', () => {
  let tdb: TestDatabase;
  let assets: Assets;
  let storage: Storage;
  let runAssetDeletion: typeof import('../deletion/deleter.js').runAssetDeletion;
  let deps: ReturnType<typeof import('../deletion/wiring.js').assetDeletionDeps>;
  let uploadAndPinPacked: typeof import('../storage/sia-client.js').uploadAndPinPacked;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    assets = await import('../db/queries/assets.js');
    storage = await import('../db/queries/storage-records.js');
    ({ runAssetDeletion } = await import('../deletion/deleter.js'));
    deps = (await import('../deletion/wiring.js')).assetDeletionDeps(pino({ level: 'silent' }));
    ({ uploadAndPinPacked } = await import('../storage/sia-client.js'));
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
    fake.reset();
  });

  async function assetWithObjects(count: number) {
    const ids = (
      await uploadAndPinPacked(Array.from({ length: count }, () => new Uint8Array(4)))
    ).map((r) => r.objectId);
    const asset = await assets.createVideoAsset({
      title: 'v',
      creatorAddress: 'alice',
      manifestObjectId: ids[0],
      thumbnailObjectIds: ids.slice(1, 2),
      siaObjectIds: ids,
    });
    await storage.persistStorageRecords(asset.id, {
      renditions: [],
      artifacts: [
        { role: 'master_manifest', objectId: ids[0], byteSize: 4, renditionName: null },
        ...ids.slice(1).map((objectId) => ({
          role: 'thumbnail' as const,
          objectId,
          byteSize: 4,
          renditionName: null,
        })),
      ],
    });
    await assets.softDeleteVideoAsset(asset.id);
    return { id: asset.id, ids };
  }

  const deleteOnce = async (id: string) =>
    runAssetDeletion(deps, { videoAssetId: id, objectIds: await assets.getAssetObjectIds(id) });

  it('completes when an object is already gone from the indexer', async () => {
    const { id, ids } = await assetWithObjects(3);
    // unpinned before, by a deletion that crashed before recording it
    fake.objects.delete(ids[1]);

    await expect(deleteOnce(id)).resolves.toMatchObject({ unpinned: 3, failed: [] });
    expect(fake.pinnedIds()).toEqual([]);
    expect((await tdb.sql`select id from video_assets where id = ${id}`).length).toBe(0);
  });

  it('converges after a deletion that failed part way, picking up only what is left', async () => {
    const { id } = await assetWithObjects(4);
    fake.before('deleteObject', () => {
      if (fake.calls.deleteObject === 3) throw new Error('host unreachable');
    });
    await expect(deleteOnce(id)).rejects.toThrow('1 object(s) failed to unpin');
    // the unpinned ones are on record as unpinned, so only the failed one is left
    expect(fake.pinnedIds()).toHaveLength(1);
    expect(await assets.getAssetObjectIds(id)).toEqual(fake.pinnedIds());

    fake.before('deleteObject', () => {});
    await expect(deleteOnce(id)).resolves.toMatchObject({ unpinned: 1, failed: [] });
    expect(fake.pinnedIds()).toEqual([]);
    expect((await tdb.sql`select id from video_assets where id = ${id}`).length).toBe(0);
  });

  it('still fails, and keeps the row, on any other indexer error', async () => {
    const { id } = await assetWithObjects(2);
    fake.fail('deleteObject', new Error('app error: Api(500, "database is locked")'));
    await expect(deleteOnce(id)).rejects.toThrow('failed to unpin');
    expect((await tdb.sql`select id from video_assets where id = ${id}`).length).toBe(1);
  });
});

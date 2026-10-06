import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as PlaybackIdQueries from '../db/queries/playback-ids.js';
import type * as ReconciliationQueries from '../db/queries/reconciliation.js';
import type * as StatsQueries from '../db/queries/stats.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import type { NewVideoAsset } from '../db/schema.js';

describe.skipIf(!hasTestDatabase)(
  'playback id, reconciliation and stats queries (postgres)',
  () => {
    let tdb: TestDatabase;
    let assets: typeof AssetQueries;
    let pb: typeof PlaybackIdQueries;
    let recon: typeof ReconciliationQueries;
    let stats: typeof StatsQueries;
    let storage: typeof StorageQueries;
    let closeDatabase: () => Promise<void>;

    beforeAll(async () => {
      tdb = await createTestDatabase();
      assets = await import('../db/queries/assets.js');
      pb = await import('../db/queries/playback-ids.js');
      recon = await import('../db/queries/reconciliation.js');
      stats = await import('../db/queries/stats.js');
      storage = await import('../db/queries/storage-records.js');
      ({ closeDatabase } = await import('../config/database.js'));
    }, 60_000);

    afterAll(async () => {
      await closeDatabase?.();
      await tdb?.drop();
    });

    beforeEach(async () => {
      await tdb.truncate();
    });

    const asset = (overrides: Partial<NewVideoAsset> = {}) =>
      assets.createVideoAsset({ title: 'v', creatorAddress: 'alice', ...overrides });

    describe('playback ids', () => {
      it('creates a public pb_ handle on the owner’s asset and resolves it back', async () => {
        const a = await asset();
        const row = await pb.createPlaybackIdForAsset(a.id, { name: 'embed' }, 'alice');
        expect(row).toMatchObject({ videoAssetId: a.id, policy: 'public', name: 'embed' });
        expect(row!.playbackId).toMatch(/^pb_/);

        expect(await pb.resolveAssetId(row!.playbackId)).toBe(a.id);
        expect((await pb.getPlaybackIdByPublicId(row!.playbackId))?.id).toBe(row!.id);
      });

      it('passes a non-playback-id through and resolves an unknown handle to null', async () => {
        expect(await pb.resolveAssetId('11111111-1111-4111-8111-111111111111')).toBe(
          '11111111-1111-4111-8111-111111111111',
        );
        // well-formed but never issued
        expect(await pb.resolveAssetId(`pb_${'A'.repeat(21)}`)).toBeNull();
      });

      it('refuses to create or list on another owner’s or a soft-deleted asset', async () => {
        const a = await asset({ creatorAddress: 'alice' });
        expect(await pb.createPlaybackIdForAsset(a.id, {}, 'bob')).toBeNull();
        expect(await pb.listPlaybackIdsByAsset(a.id, 'bob')).toBeNull();

        await assets.softDeleteVideoAsset(a.id);
        expect(await pb.createPlaybackIdForAsset(a.id, {}, 'alice')).toBeNull();
        expect(await pb.listPlaybackIdsByAsset(a.id)).toBeNull();
        const [{ n }] = await tdb.sql`select count(*)::int as n from playback_ids`;
        expect(n).toBe(0);
      });

      it('lists an asset’s handles newest first, with a platform caller seeing any tenant', async () => {
        const a = await asset({ creatorAddress: 'alice' });
        const first = await pb.createPlaybackIdForAsset(a.id, { policy: 'signed' }, 'alice');
        await tdb.sql`update playback_ids set created_at = now() - interval '1 minute' where id = ${first!.id}`;
        const second = await pb.createPlaybackIdForAsset(a.id, {}, undefined);

        expect((await pb.listPlaybackIdsByAsset(a.id, 'alice'))!.map((r) => r.id)).toEqual([
          second!.id,
          first!.id,
        ]);
        expect((await pb.listPlaybackIdsByAsset(a.id))!.map((r) => r.policy)).toEqual([
          'public',
          'signed',
        ]);
      });

      it('deletes a handle only for the owner of its asset', async () => {
        const a = await asset({ creatorAddress: 'alice' });
        const row = await pb.createPlaybackIdForAsset(a.id, {}, 'alice');

        expect(await pb.deletePlaybackIdByPublicId(row!.playbackId, 'bob')).toBe(false);
        expect(await pb.getPlaybackIdByPublicId(row!.playbackId)).toBeDefined();

        expect(await pb.deletePlaybackIdByPublicId(row!.playbackId, 'alice')).toBe(true);
        expect(await pb.deletePlaybackIdByPublicId(row!.playbackId, 'alice')).toBe(false);
      });

      it('will not let an owner delete a handle of their own soft-deleted asset', async () => {
        const a = await asset({ creatorAddress: 'alice' });
        const row = await pb.createPlaybackIdForAsset(a.id, {}, 'alice');
        await assets.softDeleteVideoAsset(a.id);
        expect(await pb.deletePlaybackIdByPublicId(row!.playbackId, 'alice')).toBe(false);
        // the platform path is unscoped
        expect(await pb.deletePlaybackIdByPublicId(row!.playbackId)).toBe(true);
      });
    });

    describe('reconciliation runs', () => {
      const summary = (finishedAt: Date, overrides: Record<string, unknown> = {}) => ({
        startedAt: new Date(finishedAt.getTime() - 1000),
        finishedAt,
        status: 'ok' as const,
        dbObjectCount: 3,
        indexerObjectCount: 3,
        inSyncCount: 3,
        orphanCount: 0,
        missingCount: 0,
        orphanedIds: [],
        missingIds: [],
        inFlightCount: 0,
        ...overrides,
      });

      it('returns the run that finished last, not the one inserted last', async () => {
        await recon.recordReconciliationRun(
          summary(new Date('2026-05-02T00:00:00Z'), { dbObjectCount: 2 }),
        );
        await recon.recordReconciliationRun(
          summary(new Date('2026-05-01T00:00:00Z'), { dbObjectCount: 1 }),
        );
        expect((await recon.getLatestReconciliationRun())?.dbObjectCount).toBe(2);
      });

      it('keeps drift details and a failure message', async () => {
        await recon.recordReconciliationRun(
          summary(new Date(), {
            status: 'drift',
            orphanCount: 1,
            missingCount: 2,
            orphanedIds: ['o1'],
            missingIds: ['m1', 'm2'],
          }),
        );
        expect(await recon.getLatestReconciliationRun()).toMatchObject({
          status: 'drift',
          orphanedIds: ['o1'],
          missingIds: ['m1', 'm2'],
          errorMessage: null,
        });

        await recon.recordReconciliationRun(
          summary(new Date(Date.now() + 1000), { status: 'failed', errorMessage: 'indexer down' }),
        );
        expect(await recon.getLatestReconciliationRun()).toMatchObject({
          status: 'failed',
          errorMessage: 'indexer down',
        });
      });

      it('returns undefined before any run', async () => {
        expect(await recon.getLatestReconciliationRun()).toBeUndefined();
      });

      it('tracks every distinct object id from artifacts and the asset columns, across tenants', async () => {
        const a = await asset({
          manifestObjectId: 'master-a',
          thumbnailObjectIds: ['thumb-a', ''],
          siaObjectIds: ['legacy-a', 'master-a', ''],
        });
        await asset({ creatorAddress: 'bob', manifestObjectId: 'master-b' });
        await asset({ title: 'empty' });
        await storage.persistStorageRecords(a.id, {
          renditions: [],
          artifacts: [
            { role: 'master_manifest', objectId: 'master-a', byteSize: 1, renditionName: null },
            { role: 'thumbnail', objectId: 'thumb-a', byteSize: 1, renditionName: null },
          ],
        });

        expect((await recon.getAllTrackedObjectIds()).sort()).toEqual([
          'legacy-a',
          'master-a',
          'master-b',
          'thumb-a',
        ]);
      });

      describe('filterObjectIdsOwnedBy', () => {
        it('keeps the ids of the owner’s assets from every source, in the given order', async () => {
          const a = await asset({
            manifestObjectId: 'master-a',
            thumbnailObjectIds: ['thumb-a'],
            siaObjectIds: ['legacy-a'],
          });
          await storage.persistStorageRecords(a.id, {
            renditions: [],
            artifacts: [
              { role: 'thumbnail', objectId: 'artifact-a', byteSize: 1, renditionName: null },
            ],
          });
          // soft-deleted assets are still in the inventory until unpinned
          const gone = await asset({ manifestObjectId: 'master-deleted' });
          await assets.softDeleteVideoAsset(gone.id);
          const b = await asset({
            creatorAddress: 'bob',
            manifestObjectId: 'master-b',
            thumbnailObjectIds: ['thumb-b'],
            siaObjectIds: ['legacy-b'],
          });
          await storage.persistStorageRecords(b.id, {
            renditions: [],
            artifacts: [
              { role: 'thumbnail', objectId: 'artifact-b', byteSize: 1, renditionName: null },
            ],
          });

          const missing = [
            'legacy-b',
            'artifact-a',
            'nobody',
            'thumb-a',
            'master-b',
            'master-deleted',
            'legacy-a',
            'thumb-b',
            'master-a',
            'artifact-b',
          ];
          expect(await recon.filterObjectIdsOwnedBy(missing, 'alice')).toEqual([
            'artifact-a',
            'thumb-a',
            'master-deleted',
            'legacy-a',
            'master-a',
          ]);
          expect(await recon.filterObjectIdsOwnedBy(missing, 'bob')).toEqual([
            'legacy-b',
            'master-b',
            'thumb-b',
            'artifact-b',
          ]);
          expect(await recon.filterObjectIdsOwnedBy(missing, 'carol')).toEqual([]);
          // an empty address owns nothing, it is not a wildcard
          expect(await recon.filterObjectIdsOwnedBy(missing, '')).toEqual([]);
        });

        it('returns nothing for an empty list without querying', async () => {
          await asset({ manifestObjectId: 'master-a' });
          expect(await recon.filterObjectIdsOwnedBy([], 'alice')).toEqual([]);
        });

        it('skips a sia_object_ids value that is not an array', async () => {
          const a = await asset({ manifestObjectId: 'master-a' });
          await tdb.sql`update video_assets set sia_object_ids = 'null'::jsonb where id = ${a.id}`;
          expect(await recon.filterObjectIdsOwnedBy(['master-a'], 'alice')).toEqual(['master-a']);
        });

        it('handles a list longer than the bind parameter limit', async () => {
          await asset({ manifestObjectId: 'needle' });
          const ids = Array.from({ length: 70_000 }, (_, i) => `id-${i}`);
          ids[65_000] = 'needle';
          expect(await recon.filterObjectIdsOwnedBy(ids, 'alice')).toEqual(['needle']);
        });
      });
    });

    describe('getAssetStats', () => {
      it('totals a tenant’s library by status, bytes, ready minutes and objects', async () => {
        const ready1 = await asset({
          status: 'ready',
          durationMs: 60_000,
          totalStorageBytes: 3_000_000_000,
        });
        await asset({ status: 'ready', durationMs: 30_000, totalStorageBytes: 3_000_000_000 });
        await asset({ status: 'failed', durationMs: 999_000, totalStorageBytes: 10 });
        await asset({ status: 'processing' });
        const deleted = await asset({ status: 'ready', durationMs: 5_000, totalStorageBytes: 7 });
        await assets.softDeleteVideoAsset(deleted.id);
        await asset({
          creatorAddress: 'bob',
          status: 'ready',
          durationMs: 1,
          totalStorageBytes: 1,
        });

        await storage.persistStorageRecords(ready1.id, {
          renditions: [],
          artifacts: [
            { role: 'master_manifest', objectId: 'm', byteSize: 1, renditionName: null },
            { role: 'thumbnail', objectId: 't', byteSize: 1, renditionName: null },
          ],
        });
        await storage.persistStorageRecords(deleted.id, {
          renditions: [],
          artifacts: [
            { role: 'master_manifest', objectId: 'gone', byteSize: 1, renditionName: null },
          ],
        });

        expect(await stats.getAssetStats('alice')).toEqual({
          total: 4,
          byStatus: { created: 0, uploading: 0, processing: 1, ready: 2, failed: 1 },
          // past 2^31, summed as bigint by postgres
          storedBytes: 6_000_000_010,
          readyDurationMs: 90_000,
          objectCount: 2,
        });
      });

      it('totals every tenant for a platform caller', async () => {
        await asset({ status: 'ready', durationMs: 1000 });
        await asset({ creatorAddress: 'bob', status: 'ready', durationMs: 2000 });
        const all = await stats.getAssetStats();
        expect(all.total).toBe(2);
        expect(all.readyDurationMs).toBe(3000);
      });

      it('reports zeros for an empty library', async () => {
        expect(await stats.getAssetStats('nobody')).toEqual({
          total: 0,
          byStatus: { created: 0, uploading: 0, processing: 0, ready: 0, failed: 0 },
          storedBytes: 0,
          readyDurationMs: 0,
          objectCount: 0,
        });
      });
    });
  },
);

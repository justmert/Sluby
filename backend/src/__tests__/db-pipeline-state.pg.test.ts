import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { buildStorageRecords, type StorageRecords } from '../storage/artifact-records.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import type * as JobQueries from '../db/queries/jobs.js';
import type * as UploadQueries from '../db/queries/uploads.js';

/**
 * The queries that hold the pipeline's state together: the pending objects
 * ledger, the finalize transaction, the retry claim, the failure write, and
 * the deletion bookkeeping, against a real postgres.
 */
describe.skipIf(!hasTestDatabase)('pipeline state queries (postgres)', () => {
  let tdb: TestDatabase;
  let assets: typeof AssetQueries;
  let storage: typeof StorageQueries;
  let jobs: typeof JobQueries;
  let uploads: typeof UploadQueries;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    assets = await import('../db/queries/assets.js');
    storage = await import('../db/queries/storage-records.js');
    jobs = await import('../db/queries/jobs.js');
    uploads = await import('../db/queries/uploads.js');
    ({ closeDatabase } = await import('../config/database.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const newAsset = async (status: 'created' | 'processing' | 'ready' | 'failed' = 'processing') => {
    const a = await assets.createVideoAsset({ title: 'v', creatorAddress: 'alice' });
    await assets.updateVideoAsset(a.id, { status });
    return a;
  };

  const newJob = async (videoAssetId: string) => {
    const s = await uploads.createUploadSession({
      uploadUrl: 'https://x/u',
      filePath: '/uploads/x',
      fileSize: 1,
      videoAssetId,
    });
    return {
      session: s,
      job: await jobs.createProcessingJob({ videoAssetId, uploadSessionId: s.id }),
    };
  };

  function records(prefix: string): StorageRecords {
    return buildStorageRecords({
      variants: [
        {
          name: '360p',
          width: 640,
          height: 360,
          videoBitrateKbps: 900,
          segmentCount: 2,
          dataObjectId: `${prefix}-data`,
          dataByteSize: 1000,
          playlistObjectId: `${prefix}-playlist`,
          playlistByteSize: 100,
        },
      ],
      thumbnails: [{ objectId: `${prefix}-thumb`, byteSize: 10 }],
      master: { objectId: `${prefix}-master`, byteSize: 50 },
    });
  }

  const runIds = (prefix: string) => [
    `${prefix}-data`,
    `${prefix}-thumb`,
    `${prefix}-playlist`,
    `${prefix}-master`,
  ];

  const finalizeInput = (prefix: string, processingJobId?: string) => ({
    records: records(prefix),
    manifestObjectId: `${prefix}-master`,
    thumbnailObjectIds: [`${prefix}-thumb`],
    siaObjectIds: runIds(prefix),
    durationMs: 4000,
    resolution: '640x360',
    segmentCount: 2,
    totalStorageBytes: 1160,
    processingJobId,
  });

  const pendingRows = async () =>
    (
      await tdb.sql<{ object_id: string; state: string }[]>`
        select object_id, state from pending_objects order by object_id`
    ).map((r) => [r.object_id, r.state]);

  describe('finalizeAssetStorage', () => {
    it('makes the asset ready with its run, in one go, and forgets the run as pending', async () => {
      const a = await newAsset();
      const { job } = await newJob(a.id);
      await storage.recordUploadingObjects(a.id, 'initial', runIds('r1'));

      const result = await storage.finalizeAssetStorage(a.id, finalizeInput('r1', job.id));

      expect(result.outcome).toBe('ready');
      const row = await assets.getVideoAssetById(a.id);
      expect(row).toMatchObject({
        status: 'ready',
        manifestObjectId: 'r1-master',
        segmentCount: 2,
      });
      expect((await storage.getArtifacts(a.id)).map((r) => r.objectId).sort()).toEqual(
        runIds('r1').sort(),
      );
      expect(await pendingRows()).toEqual([]);
      expect(await jobs.getProcessingJobByVideoAssetId(a.id)).toMatchObject({
        status: 'completed',
        progressPercent: 100,
      });
    });

    it('marks the objects it replaces, and other runs left pending, for release', async () => {
      const a = await newAsset();
      // an earlier finalize stored r1, then the asset was retried
      await storage.finalizeAssetStorage(a.id, finalizeInput('r1'));
      await assets.updateVideoAsset(a.id, { status: 'processing' });
      // a failed attempt of this run left one object recorded
      await storage.recordUploadingObjects(a.id, 'retry-1', ['stale-data']);
      await storage.recordUploadingObjects(a.id, 'retry-1', runIds('r2'));

      expect((await storage.finalizeAssetStorage(a.id, finalizeInput('r2'))).outcome).toBe('ready');

      expect(await pendingRows()).toEqual(
        [...runIds('r1'), 'stale-data'].sort().map((id) => [id, 'release']),
      );
      // and now nothing live names them, so they are what gets unpinned
      expect((await storage.listReleasedObjects({ videoAssetId: a.id })).sort()).toEqual(
        [...runIds('r1'), 'stale-data'].sort(),
      );
      expect((await storage.getArtifacts(a.id)).map((r) => r.objectId).sort()).toEqual(
        runIds('r2').sort(),
      );
    });

    it('writes nothing for an asset that is being deleted', async () => {
      const a = await newAsset();
      await assets.softDeleteVideoAsset(a.id);
      expect((await storage.finalizeAssetStorage(a.id, finalizeInput('r1'))).outcome).toBe('gone');
      expect(await storage.getArtifacts(a.id)).toEqual([]);
    });

    it('does not overwrite an asset a different run already made ready', async () => {
      const a = await newAsset();
      await storage.finalizeAssetStorage(a.id, finalizeInput('r1'));
      expect(await storage.finalizeAssetStorage(a.id, finalizeInput('dup'))).toEqual({
        outcome: 'not-processing',
        status: 'ready',
      });
      expect((await assets.getVideoAssetById(a.id))?.manifestObjectId).toBe('r1-master');
    });

    it('recognises its own earlier run as done', async () => {
      const a = await newAsset();
      await storage.finalizeAssetStorage(a.id, finalizeInput('r1'));
      expect((await storage.finalizeAssetStorage(a.id, finalizeInput('r1'))).outcome).toBe(
        'already-ready',
      );
    });

    it('makes a concurrent soft delete wait, so the deletion sees every object', async () => {
      const a = await newAsset();
      const [finalized] = await Promise.all([
        storage.finalizeAssetStorage(a.id, finalizeInput('r1')),
        assets.softDeleteVideoAsset(a.id),
      ]);
      const ids = (await assets.getAssetObjectIds(a.id)).sort();
      if (finalized.outcome === 'ready') expect(ids).toEqual(runIds('r1').sort());
      else expect(ids).toEqual([]);
    });
  });

  describe('pending objects', () => {
    it('releases uploading objects whose asset stopped processing or is gone', async () => {
      const processing = await newAsset('processing');
      const failed = await newAsset('failed');
      const deleting = await newAsset('processing');
      await assets.softDeleteVideoAsset(deleting.id);
      await storage.recordUploadingObjects(processing.id, 'initial', ['p1']);
      await storage.recordUploadingObjects(failed.id, 'initial', ['f1']);
      await storage.recordUploadingObjects(deleting.id, 'initial', ['d1']);
      await storage.recordUploadingObjects('00000000-0000-4000-8000-000000000000', 'initial', [
        'g1',
      ]);

      expect(await storage.releaseAbandonedObjects()).toBe(3);
      expect(await pendingRows()).toEqual([
        ['d1', 'release'],
        ['f1', 'release'],
        ['g1', 'release'],
        ['p1', 'uploading'],
      ]);
    });

    it('never offers an object an artifact still names for release', async () => {
      const a = await newAsset();
      await storage.finalizeAssetStorage(a.id, finalizeInput('r1'));
      await storage.recordUploadingObjects(a.id, 'x', ['r1-master']);
      await storage.markObjectsForRelease(['r1-master']);
      expect(await storage.listReleasedObjects()).toEqual([]);
    });

    it('is part of what a deletion unpins, and is forgotten once unpinned', async () => {
      const a = await newAsset();
      await storage.recordUploadingObjects(a.id, 'initial', ['up1', 'up2']);
      expect((await assets.getAssetObjectIds(a.id)).sort()).toEqual(['up1', 'up2']);
      await assets.markObjectsUnpinned(a.id, ['up1']);
      expect(await assets.getAssetObjectIds(a.id)).toEqual(['up2']);
    });
  });

  describe('markObjectsUnpinned', () => {
    it('loses no removal when two deletions of one asset record at once', async () => {
      for (let round = 0; round < 25; round++) {
        const a = await assets.createVideoAsset({
          title: 'v',
          creatorAddress: 'alice',
          manifestObjectId: 'm',
          thumbnailObjectIds: ['t1', 't2', 't3', 't4'],
          siaObjectIds: ['s1', 's2', 's3', 's4'],
        });
        await Promise.all([
          assets.markObjectsUnpinned(a.id, ['t1', 's1', 'm']),
          assets.markObjectsUnpinned(a.id, ['t2', 's2']),
          assets.markObjectsUnpinned(a.id, ['t3', 's3']),
        ]);
        const [row] = await tdb.sql`
          select manifest_object_id, thumbnail_object_ids, sia_object_ids
          from video_assets where id = ${a.id}`;
        expect(row).toEqual({
          manifest_object_id: null,
          thumbnail_object_ids: ['t4'],
          sia_object_ids: ['s4'],
        });
      }
    });

    it('bumps updated_at', async () => {
      const a = await assets.createVideoAsset({
        title: 'v',
        creatorAddress: 'alice',
        manifestObjectId: 'm',
      });
      await tdb.sql`update video_assets set updated_at = now() - interval '1 day' where id = ${a.id}`;
      await assets.markObjectsUnpinned(a.id, ['m']);
      const [row] = await tdb.sql`select updated_at > now() - interval '1 minute' as fresh
        from video_assets where id = ${a.id}`;
      expect(row.fresh).toBe(true);
    });
  });

  describe('retry claim', () => {
    it('lets exactly one of several concurrent retries move the asset', async () => {
      const a = await newAsset('failed');
      const won = await Promise.all(
        Array.from({ length: 5 }, () => assets.claimFailedAssetForRetry(a.id, 'alice')),
      );
      expect(won.filter(Boolean)).toHaveLength(1);
      expect((await assets.getVideoAssetById(a.id))?.status).toBe('processing');
    });

    it('refuses another owner, a non-failed asset and one being deleted', async () => {
      const a = await newAsset('failed');
      expect(await assets.claimFailedAssetForRetry(a.id, 'mallory')).toBe(false);
      const ready = await newAsset('ready');
      expect(await assets.claimFailedAssetForRetry(ready.id)).toBe(false);
      await assets.softDeleteVideoAsset(a.id);
      expect(await assets.claimFailedAssetForRetry(a.id)).toBe(false);
    });

    it('can be given back', async () => {
      const a = await newAsset('failed');
      await assets.claimFailedAssetForRetry(a.id);
      await assets.releaseRetryClaim(a.id);
      expect((await assets.getVideoAssetById(a.id))?.status).toBe('failed');
    });
  });

  describe('failProcessingAsset', () => {
    it('fails a processing or created asset, never a ready one', async () => {
      const processing = await newAsset('processing');
      const created = await newAsset('created');
      const ready = await newAsset('ready');
      expect(await assets.failProcessingAsset(processing.id)).toBe(true);
      expect(await assets.failProcessingAsset(created.id)).toBe(true);
      expect(await assets.failProcessingAsset(ready.id)).toBe(false);
      expect(await assets.failProcessingAsset(processing.id)).toBe(false);
      expect((await assets.getVideoAssetById(ready.id))?.status).toBe('ready');
    });
  });

  describe('transcodeOutputDispositions', () => {
    it('keeps output for processing and failed assets only', async () => {
      const processing = await newAsset('processing');
      const failed = await newAsset('failed');
      const ready = await newAsset('ready');
      const deleting = await newAsset('failed');
      await assets.softDeleteVideoAsset(deleting.id);
      const missing = '00000000-0000-4000-8000-000000000000';
      const result = await assets.transcodeOutputDispositions([
        processing.id,
        failed.id,
        ready.id,
        deleting.id,
        missing,
      ]);
      expect(Object.fromEntries(result)).toEqual({
        [processing.id]: 'keep',
        [failed.id]: 'keep',
        [ready.id]: 'remove',
        [deleting.id]: 'remove',
        [missing]: 'remove',
      });
    });
  });

  describe('processing job runs', () => {
    it('keeps the first start time across attempts and counts retries', async () => {
      const a = await newAsset();
      const { job } = await newJob(a.id);
      const first = await jobs.updateProcessingJobStatus(job.id, { status: 'processing' });
      await tdb.sql`update processing_jobs set started_at = now() - interval '1 hour' where id = ${job.id}`;
      await jobs.recordProcessingRetry(job.id, 'boom');
      const again = await jobs.updateProcessingJobStatus(job.id, { status: 'processing' });

      expect(first?.startedAt).toBeInstanceOf(Date);
      expect(again!.startedAt!.getTime()).toBeLessThan(first!.startedAt!.getTime() - 59 * 60_000);
      expect(again).toMatchObject({ retryCount: 1, errorMessage: 'boom' });

      await jobs.restartProcessingJob(job.id);
      expect(await jobs.getProcessingJobByVideoAssetId(a.id)).toMatchObject({
        status: 'queued',
        retryCount: 2,
        startedAt: null,
        errorMessage: null,
      });
    });
  });

  describe('getCompletedUploadSessionForAsset', () => {
    it('finds the finished upload of an asset', async () => {
      const a = await newAsset('failed');
      const { session } = await newJob(a.id);
      expect(await uploads.getCompletedUploadSessionForAsset(a.id)).toBeUndefined();
      await uploads.updateUploadSession(session.id, { status: 'completed' });
      expect((await uploads.getCompletedUploadSessionForAsset(a.id))?.id).toBe(session.id);
    });
  });
});

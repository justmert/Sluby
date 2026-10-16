import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { buildStorageRecords, type StorageRecords } from '../storage/artifact-records.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import type * as JobQueries from '../db/queries/jobs.js';
import type * as UploadQueries from '../db/queries/uploads.js';

describe.skipIf(!hasTestDatabase)('pipeline record queries (postgres)', () => {
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

  const newAsset = () => assets.createVideoAsset({ title: 'v', creatorAddress: 'alice' });

  // the shape the segment uploader hands to finalize for a two-rung upload
  function twoRungRecords(prefix = ''): StorageRecords {
    return buildStorageRecords({
      variants: [
        {
          name: '360p',
          width: 640,
          height: 360,
          videoBitrateKbps: 931,
          segmentCount: 3,
          dataObjectId: `${prefix}d360`,
          dataByteSize: 1_400_000,
          playlistObjectId: `${prefix}p360`,
          playlistByteSize: 400,
        },
        {
          name: '720p',
          width: 1280,
          height: 720,
          videoBitrateKbps: 3745,
          segmentCount: 3,
          dataObjectId: `${prefix}d720`,
          dataByteSize: 5_000_000_000,
          playlistObjectId: `${prefix}p720`,
          playlistByteSize: 410,
        },
      ],
      thumbnails: [
        { objectId: `${prefix}t25`, byteSize: 20_000 },
        { objectId: `${prefix}t50`, byteSize: 21_000 },
      ],
      master: { objectId: `${prefix}master`, byteSize: 300 },
    });
  }

  describe('persistStorageRecords', () => {
    it('stores each rendition and links every artifact to its rendition', async () => {
      const a = await newAsset();
      await storage.persistStorageRecords(a.id, twoRungRecords());

      expect(await storage.getRenditions(a.id)).toEqual([
        {
          name: '720p',
          width: 1280,
          height: 720,
          videoBitrateKbps: 3745,
          segmentCount: 3,
          byteSize: 5_000_000_000,
          dataObjectId: 'd720',
          playlistObjectId: 'p720',
        },
        {
          name: '360p',
          width: 640,
          height: 360,
          videoBitrateKbps: 931,
          segmentCount: 3,
          byteSize: 1_400_000,
          dataObjectId: 'd360',
          playlistObjectId: 'p360',
        },
      ]);

      const byObject = Object.fromEntries(
        (await storage.getArtifacts(a.id)).map((r) => [r.objectId, r]),
      );
      expect(Object.keys(byObject).sort()).toEqual(
        ['d360', 'd720', 'master', 'p360', 'p720', 't25', 't50'].sort(),
      );
      expect(byObject.d720).toEqual({
        objectId: 'd720',
        role: 'rendition_data',
        renditionName: '720p',
        byteSize: 5_000_000_000,
      });
      expect(byObject.p360).toMatchObject({ role: 'variant_playlist', renditionName: '360p' });
      expect(byObject.master).toMatchObject({ role: 'master_manifest', renditionName: null });
      expect(byObject.t50).toMatchObject({
        role: 'thumbnail',
        renditionName: null,
        byteSize: 21_000,
      });

      // the foreign key really points at the rendition row of the same name
      const linked = await tdb.sql<{ object_id: string; name: string }[]>`
        select a.object_id, r.name from artifacts a join renditions r on r.id = a.rendition_id
        order by a.object_id
      `;
      expect(linked.map((l) => `${l.object_id}:${l.name}`)).toEqual([
        'd360:360p',
        'd720:720p',
        'p360:360p',
        'p720:720p',
      ]);
    });

    it('replaces rather than duplicates the mapping on a retried run', async () => {
      const a = await newAsset();
      await storage.persistStorageRecords(a.id, twoRungRecords('first-'));
      await storage.persistStorageRecords(a.id, twoRungRecords('second-'));

      const objectIds = (await storage.getArtifacts(a.id)).map((r) => r.objectId);
      expect(objectIds).toHaveLength(7);
      expect(objectIds.every((id) => id.startsWith('second-'))).toBe(true);
      expect(await storage.getRenditions(a.id)).toHaveLength(2);
    });

    it('leaves other assets alone', async () => {
      const a = await newAsset();
      const b = await newAsset();
      await storage.persistStorageRecords(a.id, twoRungRecords('a-'));
      await storage.persistStorageRecords(b.id, twoRungRecords('b-'));
      await storage.persistStorageRecords(a.id, { renditions: [], artifacts: [] });

      expect(await storage.getArtifacts(a.id)).toEqual([]);
      expect(await storage.getRenditions(a.id)).toEqual([]);
      expect(await storage.getArtifacts(b.id)).toHaveLength(7);
    });

    it('rolls the whole write back when an artifact names an unknown rendition', async () => {
      const a = await newAsset();
      await storage.persistStorageRecords(a.id, twoRungRecords('kept-'));

      const broken = twoRungRecords('new-');
      broken.artifacts.push({
        role: 'rendition_data',
        objectId: 'orphan',
        byteSize: 1,
        renditionName: '1080p',
      });
      await expect(storage.persistStorageRecords(a.id, broken)).rejects.toThrow(
        /no inserted rendition named "1080p"/,
      );

      // the earlier mapping survives: the delete and inserts were one transaction
      const objectIds = (await storage.getArtifacts(a.id)).map((r) => r.objectId);
      expect(objectIds).toHaveLength(7);
      expect(objectIds.every((id) => id.startsWith('kept-'))).toBe(true);
    });

    it('stores asset-level artifacts for an asset without renditions', async () => {
      const a = await newAsset();
      await storage.persistStorageRecords(a.id, {
        renditions: [],
        artifacts: [{ role: 'master_manifest', objectId: 'm', byteSize: 3, renditionName: null }],
      });
      expect(await storage.getArtifacts(a.id)).toEqual([
        { objectId: 'm', role: 'master_manifest', renditionName: null, byteSize: 3 },
      ]);
    });

    it('fails for an asset that does not exist', async () => {
      await expect(
        storage.persistStorageRecords('00000000-0000-4000-8000-000000000000', twoRungRecords()),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });

  describe('upload sessions', () => {
    it('creates, reads and updates a session', async () => {
      const a = await newAsset();
      const created = await uploads.createUploadSession({
        uploadUrl: 'https://x/api/v1/uploads/1',
        filePath: '/uploads/1',
        fileSize: 6_000_000_000,
        videoAssetId: a.id,
        metadata: { title: 'v' },
      });
      expect(created).toMatchObject({ status: 'uploading', uploadedBytes: 0, sha256Hash: null });

      const updated = await uploads.updateUploadSession(created.id, {
        uploadedBytes: 6_000_000_000,
        status: 'completed',
        sha256Hash: 'ab'.repeat(32),
      });
      expect(updated).toMatchObject({
        uploadedBytes: 6_000_000_000,
        status: 'completed',
        sha256Hash: 'ab'.repeat(32),
        metadata: { title: 'v' },
      });
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      expect((await uploads.getUploadSessionById(created.id))?.status).toBe('completed');
    });

    it('returns undefined for an unknown session', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect(await uploads.getUploadSessionById(unknown)).toBeUndefined();
      expect(await uploads.updateUploadSession(unknown, { status: 'failed' })).toBeUndefined();
    });

    it('lists the upload file paths of one asset, skipping cancelled sessions and those without one', async () => {
      const a = await newAsset();
      const other = await newAsset();
      const session = (filePath: string, videoAssetId: string) =>
        uploads.createUploadSession({
          uploadUrl: 'https://x/api/v1/uploads/s',
          filePath,
          fileSize: 1,
          videoAssetId,
        });
      await session('/uploads/first', a.id);
      await session('/uploads/second', a.id);
      await session('', a.id);
      const cancelled = await session('/uploads/cancelled', a.id);
      await uploads.updateUploadSession(cancelled.id, { status: 'cancelled' });
      await session('/uploads/other', other.id);

      expect((await uploads.listUploadFilePaths(a.id)).sort()).toEqual([
        '/uploads/first',
        '/uploads/second',
      ]);
      expect(await uploads.listUploadFilePaths(other.id)).toEqual(['/uploads/other']);
    });

    it('says which sources their assets still need', async () => {
      const session = (filePath: string, videoAssetId: string) =>
        uploads.createUploadSession({
          uploadUrl: 'https://x/api/v1/uploads/s',
          filePath,
          fileSize: 1,
          videoAssetId,
        });
      const ready = await newAsset();
      await assets.updateVideoAsset(ready.id, { status: 'ready' });
      const failed = await newAsset();
      await assets.updateVideoAsset(failed.id, { status: 'failed' });
      const processing = await newAsset();
      await assets.updateVideoAsset(processing.id, { status: 'processing' });
      const softDeleted = await newAsset();
      await tdb.sql`update video_assets set deleted_at = now() where id = ${softDeleted.id}`;
      const hardDeleted = await newAsset();
      const cancelledAsset = await newAsset();

      await session('/u/ready', ready.id);
      await session('/u/failed', failed.id);
      await session('/u/processing', processing.id);
      await session('/u/soft', softDeleted.id);
      await session('/u/hard', hardDeleted.id);
      const cancelled = await session('/u/cancelled', cancelledAsset.id);
      await uploads.updateUploadSession(cancelled.id, { status: 'cancelled' });
      // the session row outlives a hard-deleted asset with a null asset id
      await tdb.sql`delete from video_assets where id = ${hardDeleted.id}`;

      const states = await uploads.sourceFileStates([
        '/u/ready',
        '/u/failed',
        '/u/processing',
        '/u/soft',
        '/u/hard',
        '/u/cancelled',
        '/u/unknown',
      ]);
      expect(Object.fromEntries(states)).toEqual({
        '/u/ready': 'ready',
        '/u/failed': 'in-use',
        '/u/processing': 'in-use',
        '/u/soft': 'gone',
        '/u/hard': 'gone',
        '/u/cancelled': 'cancelled',
      });
    });

    it('forgets the sessions of deleted assets once their files are gone', async () => {
      const session = (filePath: string, videoAssetId: string) =>
        uploads.createUploadSession({
          uploadUrl: 'https://x/api/v1/uploads/s',
          filePath,
          fileSize: 1,
          videoAssetId,
        });
      const live = await newAsset();
      const deletedA = await newAsset();
      const deletedB = await newAsset();
      const deletedC = await newAsset();
      await session('/u/live', live.id);
      await session('/u/removed', deletedA.id);
      await session('/u/still-on-disk', deletedB.id);
      await session('', deletedC.id);
      for (const a of [deletedA, deletedB, deletedC]) {
        await tdb.sql`delete from video_assets where id = ${a.id}`;
      }

      // the sweep lists what is still in UPLOAD_DIR
      expect(await uploads.deleteDetachedUploadSessions(['/u/live', '/u/still-on-disk'])).toBe(2);

      const left = await tdb.sql<{ file_path: string }[]>`
        select file_path from upload_sessions order by file_path
      `;
      // a live asset's session stays whatever is on disk; a deleted asset's
      // stays while its file does, so the sweep can still remove it
      expect(left.map((r) => r.file_path)).toEqual(['/u/live', '/u/still-on-disk']);
    });
  });

  describe('processing jobs', () => {
    async function newJob() {
      const a = await newAsset();
      const s = await uploads.createUploadSession({
        uploadUrl: 'u',
        filePath: '/f',
        fileSize: 1,
        videoAssetId: a.id,
      });
      const job = await jobs.createProcessingJob({ videoAssetId: a.id, uploadSessionId: s.id });
      return { asset: a, session: s, job };
    }

    it('starts queued with no progress', async () => {
      const { job } = await newJob();
      expect(job).toMatchObject({
        status: 'queued',
        progressPercent: 0,
        retryCount: 0,
        logs: [],
        startedAt: null,
        completedAt: null,
      });
    });

    it('stamps startedAt on processing and completedAt with 100% on completion', async () => {
      const { job } = await newJob();
      const started = await jobs.updateProcessingJobStatus(job.id, {
        status: 'processing',
        progressPercent: 5,
      });
      expect(started).toMatchObject({ status: 'processing', progressPercent: 5 });
      expect(started!.startedAt).toBeInstanceOf(Date);
      expect(started!.completedAt).toBeNull();

      const done = await jobs.updateProcessingJobStatus(job.id, { status: 'completed' });
      expect(done).toMatchObject({ status: 'completed', progressPercent: 100 });
      expect(done!.completedAt).toBeInstanceOf(Date);
      expect(done!.startedAt!.getTime()).toBe(started!.startedAt!.getTime());
    });

    it('records and then clears an error message', async () => {
      const { job } = await newJob();
      const failed = await jobs.updateProcessingJobStatus(job.id, {
        status: 'failed',
        errorMessage: 'ffmpeg exited with code 1',
      });
      expect(failed?.errorMessage).toBe('ffmpeg exited with code 1');

      // leaving errorMessage out keeps it
      const retrying = await jobs.updateProcessingJobStatus(job.id, { status: 'retrying' });
      expect(retrying?.errorMessage).toBe('ffmpeg exited with code 1');

      const retried = await jobs.updateProcessingJobStatus(job.id, {
        status: 'processing',
        errorMessage: null,
      });
      expect(retried?.errorMessage).toBeNull();
    });

    it('updates progress on its own', async () => {
      const { job } = await newJob();
      expect((await jobs.updateProcessingJobProgress(job.id, 42))?.progressPercent).toBe(42);
    });

    it('appends log entries in order without losing earlier ones', async () => {
      const { job } = await newJob();
      await jobs.appendProcessingLog(job.id, 'transcode', 'Starting transcode for a.mp4');
      await jobs.appendProcessingLog(job.id, 'upload', 'Uploading "quoted" \\ text');
      await jobs.appendProcessingLog(job.id, 'finalize', 'Done');

      const row = (await jobs.getProcessingJobByVideoAssetId(job.videoAssetId))!;
      expect(row.logs!.map((l) => [l.stage, l.message])).toEqual([
        ['transcode', 'Starting transcode for a.mp4'],
        ['upload', 'Uploading "quoted" \\ text'],
        ['finalize', 'Done'],
      ]);
      for (const l of row.logs!) expect(Date.parse(l.timestamp)).not.toBeNaN();
    });

    it('appends to a job whose logs column is null', async () => {
      const { job } = await newJob();
      await tdb.sql`update processing_jobs set logs = null where id = ${job.id}`;
      await jobs.appendProcessingLog(job.id, 'transcode', 'first');
      const j = await jobs.getProcessingJobByVideoAssetId(job.videoAssetId);
      expect(j!.logs!.map((l) => l.message)).toEqual(['first']);
    });

    it('finds the latest job by asset and by upload session', async () => {
      const { asset, session, job } = await newJob();
      await tdb.sql`update processing_jobs set created_at = now() - interval '1 hour' where id = ${job.id}`;
      const newer = await jobs.createProcessingJob({
        videoAssetId: asset.id,
        uploadSessionId: session.id,
      });

      expect((await jobs.getProcessingJobByVideoAssetId(asset.id))?.id).toBe(newer.id);
      expect((await jobs.getProcessingJobByUploadSessionId(session.id))?.id).toBe(newer.id);
      expect(
        await jobs.getProcessingJobByVideoAssetId('00000000-0000-4000-8000-000000000000'),
      ).toBeUndefined();
    });
  });
});

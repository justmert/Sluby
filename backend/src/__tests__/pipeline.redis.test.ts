import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import pino from 'pino';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { hasTestRedis, testRedisConnection } from './helpers/redis.js';
import type {
  TranscodeJobData,
  UploadSegmentsJobData,
  FinalizeJobData,
} from '../queue/bull-config.js';

const dirs = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const os = await import('node:os');
  const p = await import('node:path');
  const root = mkdtempSync(p.join(os.tmpdir(), 'sluby-pipeline-'));
  process.env.TRANSCODE_OUTPUT_DIR = p.join(root, 'out');
  process.env.UPLOAD_DIR = p.join(root, 'uploads');
  return { root, out: p.join(root, 'out'), uploads: p.join(root, 'uploads') };
});

// the sia-storage sdk is the boundary: everything above it runs for real
const fake = await vi.hoisted(async () => (await import('./helpers/fake-sia.js')).createFakeSia());
vi.mock('@siafoundation/sia-storage', () => fake.module);
// the prune gate's leases live in memory here; slab-prune-gate.redis.test.ts covers the redis ones
vi.mock('../storage/prune-leases.js', async () => {
  const { MemoryPruneLeases } = await import('./helpers/memory-prune-leases.js');
  return {
    RedisPruneLeases: class extends MemoryPruneLeases {
      constructor() {
        super();
      }
    },
  };
});

// FFmpeg is the other boundary: the fake copies real FFmpeg output of a 1 s clip
const ff = vi.hoisted(() => ({
  outputDirs: [] as string[],
  hook: null as null | ((call: number, outputDir: string) => Promise<void>),
}));
vi.mock('../transcode/ffmpeg-runner.js', async () => {
  const { cp } = await import('node:fs/promises');
  const p = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const fixture = fileURLToPath(new URL('./fixtures/hls-1s', import.meta.url));
  return {
    TRANSCODE_CONCURRENCY: 4,
    transcode: async (_input: string, outputDir: string) => {
      const call = ff.outputDirs.push(outputDir);
      await ff.hook?.(call, outputDir);
      await cp(fixture, outputDir, { recursive: true, filter: (src) => !src.endsWith('.jpg') });
      return {
        masterPlaylistPath: p.join(outputDir, 'master.m3u8'),
        variantDirs: [p.join(outputDir, '360p')],
        segmentCount: 1,
        durationMs: 1000,
        resolution: '320x180',
      };
    },
  };
});
vi.mock('../transcode/thumbnail-extractor.js', async () => {
  const { copyFile } = await import('node:fs/promises');
  const p = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const fixture = fileURLToPath(new URL('./fixtures/hls-1s', import.meta.url));
  return {
    extractThumbnails: async (_input: string, _ms: number, outputDir: string) => {
      const paths: string[] = [];
      for (const n of [25, 50, 75]) {
        const target = p.join(outputDir, `thumb_${n}.jpg`);
        await copyFile(p.join(fixture, `thumb_${n}.jpg`), target);
        paths.push(target);
      }
      return paths;
    },
  };
});

// lets a test fail or interleave with the finalize transaction
const faults = vi.hoisted(() => ({ beforeFinalize: [] as Array<() => Promise<void>> }));
vi.mock('../db/queries/storage-records.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/queries/storage-records.js')>();
  return {
    ...real,
    finalizeAssetStorage: async (...args: Parameters<typeof real.finalizeAssetStorage>) => {
      await faults.beforeFinalize.shift()?.();
      return real.finalizeAssetStorage(...args);
    },
  };
});

type Pipeline = typeof import('../queue/pipeline.js');
type Assets = typeof import('../db/queries/assets.js');
type Jobs = typeof import('../db/queries/jobs.js');
type Uploads = typeof import('../db/queries/uploads.js');
type Wiring = typeof import('../deletion/wiring.js');
type Deleter = typeof import('../deletion/deleter.js');
type Retry = typeof import('../queue/retry.js');
type OutputDirs = typeof import('../queue/output-dirs.js');

const log = pino({ level: 'silent' });

async function waitFor<T>(check: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * The transcode, upload and finalize workers against a real redis and
 * postgres, with the Sia SDK and FFmpeg faked at their boundaries. Each test
 * ends by checking that every object pinned on the fake indexer is on record
 * (an artifact or a pending object) or was unpinned.
 */
describe.skipIf(!hasTestDatabase || !hasTestRedis)(
  'pipeline workers (redis, postgres)',
  { timeout: 30_000 },
  () => {
    let tdb: TestDatabase;
    let pipeline: Pipeline;
    let assets: Assets;
    let jobs: Jobs;
    let uploads: Uploads;
    let wiring: Wiring;
    let deleter: Deleter;
    let retry: Retry;
    let outputDirs: OutputDirs;
    let closeDatabase: () => Promise<void>;

    let prefix: string;
    let queues: {
      transcode: Queue<TranscodeJobData>;
      uploadSegments: Queue<UploadSegmentsJobData>;
      finalize: Queue<FinalizeJobData>;
    };
    let workers: Awaited<ReturnType<Pipeline['createPipelineWorkers']>>;
    let events: Array<[string, string, Record<string, unknown> | undefined]>;
    let finalizeAddFailures: number;
    const releases: Array<() => void> = [];

    beforeAll(async () => {
      tdb = await createTestDatabase();
      pipeline = await import('../queue/pipeline.js');
      assets = await import('../db/queries/assets.js');
      jobs = await import('../db/queries/jobs.js');
      uploads = await import('../db/queries/uploads.js');
      wiring = await import('../deletion/wiring.js');
      deleter = await import('../deletion/deleter.js');
      retry = await import('../queue/retry.js');
      outputDirs = await import('../queue/output-dirs.js');
      ({ closeDatabase } = await import('../config/database.js'));
      mkdirSync(dirs.uploads, { recursive: true });
    }, 60_000);

    afterAll(async () => {
      await closeDatabase?.();
      await tdb?.drop();
    });

    const queueOptions = {
      attempts: 3,
      backoff: { type: 'fixed' as const, delay: 100 },
      removeOnComplete: false,
      removeOnFail: false,
    };

    beforeEach(async () => {
      await tdb.truncate();
      fake.reset();
      ff.outputDirs = [];
      ff.hook = null;
      faults.beforeFinalize = [];
      events = [];
      finalizeAddFailures = 0;
      prefix = `sluby-test-${randomBytes(4).toString('hex')}`;
      const connection = testRedisConnection();
      queues = {
        transcode: new Queue('transcode', { connection, prefix, defaultJobOptions: queueOptions }),
        uploadSegments: new Queue('upload-segments', {
          connection,
          prefix,
          defaultJobOptions: queueOptions,
        }),
        finalize: new Queue('finalize', { connection, prefix, defaultJobOptions: queueOptions }),
      };
      workers = pipeline.createPipelineWorkers({
        connection,
        prefix,
        outputRoot: dirs.out,
        queues: {
          uploadSegments: queues.uploadSegments,
          finalize: {
            add: (...args: Parameters<Queue<FinalizeJobData>['add']>) =>
              finalizeAddFailures-- > 0
                ? Promise.reject(new Error('connection lost'))
                : queues.finalize.add(...args),
            getJob: (id: string) => queues.finalize.getJob(id),
          },
        },
        emit: async (event, videoAssetId, data) => {
          events.push([event, videoAssetId, data]);
        },
        workerOptions: { lockDuration: 1_500, stalledInterval: 300 },
        failureWriteDelaysMs: [20, 20],
        uploadLeaseRenewMs: 100,
      });
    });

    afterEach(async () => {
      for (const release of releases.splice(0)) release();
      await workers.close();
      for (const q of Object.values(queues)) {
        await q.obliterate({ force: true });
        await q.close();
      }
    });

    async function uploadedAsset() {
      const asset = await assets.createVideoAsset({ title: 'clip', creatorAddress: 'alice' });
      const filePath = path.join(dirs.uploads, asset.id);
      writeFileSync(filePath, 'source bytes');
      const session = await uploads.createUploadSession({
        uploadUrl: 'https://x/u',
        filePath,
        fileSize: 12,
        videoAssetId: asset.id,
      });
      await uploads.updateUploadSession(session.id, { status: 'completed' });
      await jobs.createProcessingJob({ videoAssetId: asset.id, uploadSessionId: session.id });
      return { id: asset.id, sessionId: session.id, filePath };
    }

    const start = (a: { id: string; sessionId: string; filePath: string }) =>
      queues.transcode.add(
        'transcode',
        { videoAssetId: a.id, uploadSessionId: a.sessionId, filePath: a.filePath },
        { jobId: `transcode-${a.id}` },
      );

    const status = async (id: string) =>
      (await tdb.sql`select status from video_assets where id = ${id}`)[0]?.status as
        string | undefined;

    const statusIs = (id: string, wanted: string) => async () => (await status(id)) === wanted;

    /** No pipeline job is waiting, delayed or running: every stage has finished its work. */
    const idle = async () => {
      for (const q of Object.values(queues)) {
        const c = await q.getJobCounts('active', 'waiting', 'delayed');
        if (c.active + c.waiting + c.delayed > 0) return false;
      }
      return true;
    };

    const settledAs = async (id: string, wanted: string) => {
      await waitFor(statusIs(id, wanted));
      await waitFor(idle);
    };

    const artifactIds = async (id: string) =>
      (
        await tdb.sql<{ object_id: string }[]>`
        select object_id from artifacts where video_asset_id = ${id}`
      )
        .map((r) => r.object_id)
        .sort();

    const pendingIds = async () =>
      (await tdb.sql<{ object_id: string }[]>`select object_id from pending_objects`)
        .map((r) => r.object_id)
        .sort();

    /** Every pinned object has a row that leads to it. */
    async function expectEveryPinnedObjectOnRecord() {
      const known = new Set(
        (
          await tdb.sql<{ object_id: string }[]>`
          select object_id from artifacts union select object_id from pending_objects`
        ).map((r) => r.object_id),
      );
      expect(fake.pinnedIds().filter((id) => !known.has(id))).toEqual([]);
    }

    const deleteAsset = async (id: string) => {
      await assets.softDeleteVideoAsset(id);
      await deleter.runAssetDeletion(wiring.assetDeletionDeps(log), {
        videoAssetId: id,
        objectIds: await assets.getAssetObjectIds(id),
      });
    };

    /** The deletion gc sweep's object and output parts. */
    const sweep = async () => {
      await wiring.releaseLeftoverObjects();
      await wiring.sweepTranscodeOutput(log);
    };

    const gate = () => {
      let open: () => void = () => {};
      const opened = new Promise<void>((r) => (open = r));
      releases.push(open);
      return { opened, open };
    };

    it('takes an upload to ready and sends processing.started and asset.ready once each', async () => {
      const a = await uploadedAsset();
      await start(a);
      await settledAs(a.id, 'ready');

      const [row] = await tdb.sql`select * from video_assets where id = ${a.id}`;
      expect(row).toMatchObject({ duration_ms: '1000', resolution: '320x180', segment_count: 1 });
      expect(row.thumbnail_object_ids).toHaveLength(3);
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(await pendingIds()).toEqual([]);
      expect(events.map(([e]) => e)).toEqual(['processing.started', 'asset.ready']);
      expect(existsSync(path.join(dirs.out, a.id))).toBe(false);
      expect(existsSync(a.filePath)).toBe(false);
      const job = await jobs.getProcessingJobByVideoAssetId(a.id);
      expect(job).toMatchObject({ status: 'completed', retryCount: 0 });
      const lines = (job!.logs ?? []).map((l) => `${l.stage}: ${l.message}`);
      expect(lines[0]).toBe(`transcode: Starting transcode of video ${a.id}`);
      // the hand-off is its own upload-stage line, before the upload starts
      const waiting = lines.indexOf('upload: Waiting for the Sia uploader');
      expect(waiting).toBeGreaterThan(0);
      expect(lines[waiting - 1]).toMatch(/^transcode: /);
      expect(lines[waiting + 1]).toBe('upload: Uploading segments to Sia');
    });

    it('fails the asset and sends asset.errored when a transcode stalls twice', async () => {
      const a = await uploadedAsset();
      // both executions hang, as a run whose process is killed would
      ff.hook = () => gate().opened;
      const job = await start(a);
      const lockKey = `${prefix}:transcode:${job.id}:lock`;
      const client = await queues.transcode.client;

      for (let execution = 1; execution <= 2; execution++) {
        await waitFor(async () => ff.outputDirs.length === execution);
        // the lock is lost, as when the worker holding it dies
        await client.del(lockKey);
      }

      await waitFor(statusIs(a.id, 'failed'));
      await waitFor(async () => events.some(([e]) => e === 'asset.errored'));
      expect(events.find(([e]) => e === 'asset.errored')?.[2]).toMatchObject({
        stage: 'transcode',
        error: expect.stringContaining('stalled'),
      });
      expect(await jobs.getProcessingJobByVideoAssetId(a.id)).toMatchObject({ status: 'failed' });
    });

    it('never rewrites the directory an upload reads when a transcode loses its lock', async () => {
      const a = await uploadedAsset();
      const first = gate();
      ff.hook = async (call) => {
        if (call === 1) await first.opened;
      };
      const job = await start(a);
      await waitFor(async () => ff.outputDirs.length === 1);
      const client = await queues.transcode.client;
      await client.del(`${prefix}:transcode:${job.id}:lock`);

      // the second execution runs while the first still holds FFmpeg
      await waitFor(statusIs(a.id, 'ready'));
      const uploadJob = await queues.uploadSegments.getJob(`upload-${a.id}`);
      expect(uploadJob?.data.outputDir).toBe(ff.outputDirs[1]);

      first.open();
      await waitFor(async () => (await job.isCompleted()) || (await job.isFailed()));
      // the two executions wrote to different directories, and the late one dropped its own
      expect(ff.outputDirs[0]).not.toBe(ff.outputDirs[1]);
      await waitFor(async () => !existsSync(ff.outputDirs[0]));
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(events.filter(([e]) => e === 'asset.ready')).toHaveLength(1);
    });

    it('runs one Sia upload at a time when the upload stage loses its lock', async () => {
      const a = await uploadedAsset();
      const first = gate();
      fake.before('add', async () => {
        if (fake.calls.add === 1) await first.opened;
      });
      await start(a);
      await waitFor(async () => fake.calls.add === 1);
      // what a host that froze for longer than the lock leaves behind: the
      // lock expired while the first execution is still uploading
      const uploadJobId = `upload-${a.id}`;
      const client = await queues.uploadSegments.client;
      await client.del(`${prefix}:upload-segments:${uploadJobId}:lock`);
      await waitFor(
        async () => ((await queues.uploadSegments.getJob(uploadJobId))?.attemptsStarted ?? 0) >= 2,
      );

      // the second execution waits for the first instead of uploading too
      await new Promise((r) => setTimeout(r, 1_000));
      expect(fake.calls.add).toBe(1);

      first.open();
      await settledAs(a.id, 'ready');
      // one execution's three packed uploads, nothing pinned twice
      expect(fake.calls.finalize).toBe(3);
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(fake.calls.pinObject).toBe(fake.pinnedIds().length);
      expect(events.filter(([e]) => e === 'asset.ready')).toHaveLength(1);
    });

    it('lets a redelivered upload go ahead once the first execution is gone', async () => {
      const a = await uploadedAsset();
      const first = gate();
      fake.before('add', async () => {
        if (fake.calls.add !== 1) return;
        await first.opened;
        throw new Error('no more hosts available');
      });
      await start(a);
      await waitFor(async () => fake.calls.add === 1);
      const uploadJobId = `upload-${a.id}`;
      const client = await queues.uploadSegments.client;
      await client.del(`${prefix}:upload-segments:${uploadJobId}:lock`);
      await waitFor(
        async () => ((await queues.uploadSegments.getJob(uploadJobId))?.attemptsStarted ?? 0) >= 2,
      );
      expect(fake.calls.add).toBe(1);

      // the first execution fails and lets go; the waiting one uploads
      first.open();
      await settledAs(a.id, 'ready');
      expect(fake.calls.add).toBeGreaterThan(1);
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(await pendingIds()).toEqual([]);
    });

    it('uploads again after a failed hand-off and keeps only the objects it uses', async () => {
      const a = await uploadedAsset();
      finalizeAddFailures = 1;
      await start(a);
      await settledAs(a.id, 'ready');

      // the first attempt's six objects were pinned too, then released by finalize
      expect(fake.calls.pinObject).toBe(12);
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(await pendingIds()).toEqual([]);
      expect((await jobs.getProcessingJobByVideoAssetId(a.id))?.retryCount).toBe(1);
    });

    it('keeps every object on record through failed finalizes, and a retry cleans them up', async () => {
      const a = await uploadedAsset();
      for (let i = 0; i < 3; i++) {
        faults.beforeFinalize.push(async () => {
          throw new Error('database unavailable');
        });
      }
      await start(a);
      await settledAs(a.id, 'failed');
      await waitFor(async () => events.some(([e]) => e === 'asset.errored'));
      expect(events.find(([e]) => e === 'asset.errored')?.[2]).toMatchObject({ stage: 'finalize' });

      // nothing is ready, and every pinned object is still recorded as pending
      expect(fake.pinnedIds()).toHaveLength(6);
      expect(await pendingIds()).toEqual(fake.pinnedIds());

      const retryAsset = retry.buildRetryAsset({
        getAsset: (id) => assets.getVideoAssetById(id),
        getProcessingJob: (id) => jobs.getProcessingJobByVideoAssetId(id),
        createProcessingJob: (videoAssetId, uploadSessionId) =>
          jobs.createProcessingJob({ videoAssetId, uploadSessionId }),
        getUploadSession: (id) => uploads.getCompletedUploadSessionForAsset(id),
        findCompletedOutput: (id) => outputDirs.findCompletedOutput(dirs.out, id),
        claimFailedAsset: (id) => assets.claimFailedAssetForRetry(id),
        releaseClaim: (id) => assets.releaseRetryClaim(id),
        restartJob: (id) => jobs.restartProcessingJob(id),
        enqueueUploadSegments: async (data, jobId) => {
          await queues.uploadSegments.add('upload-segments', data, { jobId });
        },
        enqueueTranscode: async (data, jobId) => {
          await queues.transcode.add('transcode', data, { jobId });
        },
      });
      expect(await retryAsset(a.id)).toEqual({ stage: 'upload-segments' });
      await settledAs(a.id, 'ready');

      // FFmpeg ran once; the retry reused the finished output
      expect(ff.outputDirs).toHaveLength(1);
      expect(fake.pinnedIds()).toEqual(await artifactIds(a.id));
      expect(await pendingIds()).toEqual([]);
    });

    it('starts one run when two retries arrive at once', async () => {
      const a = await uploadedAsset();
      await assets.updateVideoAsset(a.id, { status: 'failed' });
      const retryAsset = retry.buildRetryAsset({
        getAsset: (id) => assets.getVideoAssetById(id),
        getProcessingJob: (id) => jobs.getProcessingJobByVideoAssetId(id),
        createProcessingJob: (videoAssetId, uploadSessionId) =>
          jobs.createProcessingJob({ videoAssetId, uploadSessionId }),
        getUploadSession: (id) => uploads.getCompletedUploadSessionForAsset(id),
        findCompletedOutput: (id) => outputDirs.findCompletedOutput(dirs.out, id),
        claimFailedAsset: (id) => assets.claimFailedAssetForRetry(id),
        releaseClaim: (id) => assets.releaseRetryClaim(id),
        restartJob: (id) => jobs.restartProcessingJob(id),
        enqueueUploadSegments: async (data, jobId) => {
          await queues.uploadSegments.add('upload-segments', data, { jobId });
        },
        enqueueTranscode: async (data, jobId) => {
          await queues.transcode.add('transcode', data, { jobId });
        },
        now: () => Date.now() + Math.floor(Math.random() * 1_000_000),
      });

      const results = await Promise.allSettled([retryAsset(a.id), retryAsset(a.id)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await settledAs(a.id, 'ready');
      expect(await queues.transcode.getJobCounts('completed', 'active', 'waiting')).toMatchObject({
        completed: 1,
        active: 0,
        waiting: 0,
      });
      expect(ff.outputDirs).toHaveLength(1);
    });

    describe('an asset deleted while it is processing', () => {
      it('stops in the transcode stage and uploads nothing', async () => {
        const a = await uploadedAsset();
        const ffmpeg = gate();
        ff.hook = () => ffmpeg.opened;
        const job = await start(a);
        await waitFor(async () => ff.outputDirs.length === 1);

        await deleteAsset(a.id);
        ffmpeg.open();
        await waitFor(() => job.isCompleted());

        expect(fake.calls.add).toBe(0);
        expect(await queues.uploadSegments.getJobCounts('waiting', 'completed')).toMatchObject({
          waiting: 0,
          completed: 0,
        });
        expect(await status(a.id)).toBeUndefined();
        expect(existsSync(path.join(dirs.out, a.id))).toBe(false);
      });

      it('stops in the upload stage and unpins what it pinned', async () => {
        const a = await uploadedAsset();
        fake.before('finalize', async () => {
          // the first packed upload is done storing when the user deletes
          if (fake.calls.finalize === 1) await deleteAsset(a.id);
        });
        await start(a);
        await waitFor(async () => {
          const upload = await queues.uploadSegments.getJob(`upload-${a.id}`);
          return upload && (await upload.isCompleted());
        });

        expect(fake.calls.finalize).toBe(1);
        expect(fake.pinnedIds()).toEqual([]);
        expect(await pendingIds()).toEqual([]);
        expect(await status(a.id)).toBeUndefined();
        expect(existsSync(path.join(dirs.out, a.id))).toBe(false);
        await waitFor(async () => fake.orphanSlabs().length === 0);
      });

      it('stops at finalize and unpins the whole upload', async () => {
        const a = await uploadedAsset();
        faults.beforeFinalize.push(() => deleteAsset(a.id));
        await start(a);
        await waitFor(async () => {
          const finalize = await queues.finalize.getJob(`finalize-${a.id}`);
          return finalize && (await finalize.isCompleted());
        });

        expect(fake.calls.pinObject).toBe(6);
        expect(fake.pinnedIds()).toEqual([]);
        expect(await pendingIds()).toEqual([]);
        expect(await status(a.id)).toBeUndefined();
        expect(existsSync(path.join(dirs.out, a.id))).toBe(false);
        expect(events.map(([e]) => e)).toEqual(['processing.started']);
      });
    });

    it('a gc sweep unpins what a crashed upload left recorded, and removes stale output', async () => {
      const a = await uploadedAsset();
      // a crash after the pins: the objects are only in the ledger
      const ledger = (await import('../storage/object-ledger.js')).runLedger(a.id, 'initial');
      const { uploadAndPinPacked } = await import('../storage/sia-client.js');
      await uploadAndPinPacked([new Uint8Array(3), new Uint8Array(4)], {
        beforePin: ledger.record,
      });
      const runDir = await outputDirs.createRunDir(dirs.out, a.id);
      await expectEveryPinnedObjectOnRecord();

      // still processing: the sweep leaves both alone
      await assets.updateVideoAsset(a.id, { status: 'processing' });
      await sweep();
      expect(fake.pinnedIds()).toHaveLength(2);
      expect(existsSync(runDir)).toBe(true);

      await assets.softDeleteVideoAsset(a.id);
      await sweep();
      expect(fake.pinnedIds()).toEqual([]);
      expect(await pendingIds()).toEqual([]);
      expect(readdirSync(dirs.out)).not.toContain(a.id);
    });

    afterEach(async () => {
      await expectEveryPinnedObjectOnRecord();
    });
  },
);

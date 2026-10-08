import { Worker, type ConnectionOptions, type Job, type Queue, type WorkerOptions } from 'bullmq';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TranscodeJobData, UploadSegmentsJobData, FinalizeJobData } from './bull-config.js';
import { stageJobId } from './job-ids.js';
import {
  createRunDir,
  findCompletedOutput,
  removeAssetOutput,
  removeOutput,
  writeCompletionMarker,
  type CompletedOutput,
} from './output-dirs.js';
import { TRANSCODE_CONCURRENCY, transcode } from '../transcode/ffmpeg-runner.js';
import { extractThumbnails } from '../transcode/thumbnail-extractor.js';
import { uploadSegments } from '../storage/segment-uploader.js';
import { runLedger, releaseObjects, unpinReleasedObjects } from '../storage/object-ledger.js';
import { warmObjects } from '../storage/blob-manager.js';
import { failProcessingAsset, getVideoAssetById, updateVideoAsset } from '../db/queries/assets.js';
import { finalizeAssetStorage } from '../db/queries/storage-records.js';
import {
  appendProcessingLog,
  getProcessingJobByVideoAssetId,
  recordProcessingRetry,
  updateProcessingJobProgress,
  updateProcessingJobStatus,
} from '../db/queries/jobs.js';
import { getUploadSessionById } from '../db/queries/uploads.js';
import { removeSessionSource } from '../upload/source-files.js';
import { processingDurationSeconds } from '../metrics/collector.js';
import { logger as rootLogger } from '../config/logger.js';

const logger = rootLogger.child({ name: 'queue-processors' });

/**
 * A pipeline job holds its lock this long between renewals. BullMQ's 30 s
 * default hands a transcode to a second worker after one slow renewal (a
 * loaded host, a Redis stall); a crashed worker's job is still picked up
 * again after this long.
 */
export const PIPELINE_LOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * How often a running Sia upload renews its lease (see holdUploadLease). The
 * lease lasts three renewals, so one slow renewal does not lose it.
 */
export const UPLOAD_LEASE_RENEW_MS = 10_000;

/** Waits between tries of the writes that mark an asset failed. */
const FAILURE_WRITE_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

export type AssetEventEmitter = (
  event: string,
  videoAssetId: string,
  data?: Record<string, unknown>,
) => Promise<void>;

export interface PipelineOptions {
  connection: ConnectionOptions;
  prefix?: string;
  /** TRANSCODE_OUTPUT_DIR */
  outputRoot: string;
  queues: {
    uploadSegments: Pick<Queue<UploadSegmentsJobData>, 'add' | 'getJob'>;
    finalize: Pick<Queue<FinalizeJobData>, 'add' | 'getJob'>;
  };
  /** Sends a webhook event; must not throw (delivery is best effort). */
  emit: AssetEventEmitter;
  /** Tests shorten the lock and stall settings. */
  workerOptions?: Partial<WorkerOptions>;
  failureWriteDelaysMs?: number[];
  /** Defaults to UPLOAD_LEASE_RENEW_MS; tests shorten it. */
  uploadLeaseRenewMs?: number;
}

export interface PipelineWorkers {
  transcode: Worker<TranscodeJobData>;
  uploadSegments: Worker<UploadSegmentsJobData>;
  finalize: Worker<FinalizeJobData>;
  close(): Promise<void>;
}

/** Thrown inside a stage when its asset was deleted or left processing. */
class StageStopped extends Error {
  constructor(readonly videoAssetId: string) {
    super(`asset ${videoAssetId} is no longer being processed`);
  }
}

/** Thrown inside the upload stage when another execution of it took over its lease. */
class LeaseLost extends Error {
  constructor(readonly videoAssetId: string) {
    super(`another execution took over the Sia upload of asset ${videoAssetId}`);
  }
}

// set the lease when it is free or already ours; 0 when another execution holds it
const CLAIM_LEASE = `
local v = redis.call('GET', KEYS[1])
if v == false or v == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0`;
const RELEASE_LEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/**
 * Wake-ups later than this, and later than the interval itself, count as a
 * freeze rather than a busy event loop. A loaded host delays timers by a few
 * seconds; treating that as a freeze would keep a waiting execution asleep.
 */
const FREEZE_SLACK_MS = 5_000;

/**
 * Sleep `ms`, then once more for every wake-up that came much later than
 * asked. A late wake-up means the host or VM was frozen (a sleeping laptop, a
 * stalled Docker VM); every other execution's timers were frozen with it and
 * need a full interval after it to show they are still alive.
 */
async function pauseThroughFreezes(ms: number): Promise<void> {
  for (;;) {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    if (Date.now() - started <= ms + Math.max(ms, FREEZE_SLACK_MS)) return;
  }
}

/** The ledger key of a run: the retry id, or the first run's. */
const runKey = (runId: string | undefined) => runId ?? 'initial';

/** Append a line to the asset's processing log; the log is informational, so a failed write only warns. */
async function note(jobId: string | undefined, stage: string, message: string): Promise<void> {
  if (!jobId) return;
  try {
    await appendProcessingLog(jobId, stage, message);
  } catch (err) {
    logger.warn({ jobId, stage, err }, 'Could not append to the processing log');
  }
}

async function progress(job: Job, processingJobId: string | undefined, percent: number) {
  try {
    await job.updateProgress(percent);
    if (processingJobId) await updateProcessingJobProgress(processingJobId, percent);
  } catch (err) {
    logger.warn({ jobId: job.id, err }, 'Could not record progress');
  }
}

/** Whether the stage should carry on: the asset exists, is not being deleted, and is processing. */
async function stillProcessing(videoAssetId: string): Promise<boolean> {
  const asset = await getVideoAssetById(videoAssetId);
  return asset?.status === 'processing';
}

/**
 * Clean up after a stage that stopped because its asset is no longer
 * processing: all of the asset's output when the asset is gone, otherwise
 * only this execution's directory (a failed asset keeps a finished run for
 * a retry).
 */
async function dropOutput(outputRoot: string, videoAssetId: string, ownDir: string): Promise<void> {
  if (await getVideoAssetById(videoAssetId)) await removeOutput(ownDir);
  else await removeAssetOutput(outputRoot, videoAssetId);
}

/**
 * The transcode, Sia upload and finalize workers. Each stage first checks
 * that its asset is still being processed, so work queued for a deleted
 * asset stops instead of uploading a video nobody wants, and each hands off
 * to the next stage under a fixed job id, so a stage that runs twice starts
 * its successor once.
 */
export function createPipelineWorkers(opts: PipelineOptions): PipelineWorkers {
  const { outputRoot, queues, emit } = opts;
  const workerBase = {
    connection: opts.connection,
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
    lockDuration: PIPELINE_LOCK_DURATION_MS,
    ...opts.workerOptions,
  };

  // ── transcode ──

  const transcodeWorker = new Worker<TranscodeJobData>(
    'transcode',
    async (job) => {
      const { videoAssetId, uploadSessionId, filePath, runId } = job.data;
      logger.info(
        { videoAssetId, jobId: job.id, attempt: job.attemptsMade + 1 },
        'Starting transcode job',
      );

      const asset = await getVideoAssetById(videoAssetId);
      if (!asset) {
        await removeAssetOutput(outputRoot, videoAssetId);
        logger.info({ videoAssetId }, 'Asset was deleted; skipping the transcode');
        return { skipped: 'deleted' };
      }
      if (asset.status === 'ready' || asset.status === 'failed') {
        logger.info(
          { videoAssetId, status: asset.status },
          'Asset is not processing; skipping the transcode',
        );
        return { skipped: asset.status };
      }
      const uploadJobId = stageJobId('upload', videoAssetId, runId);
      if (await queues.uploadSegments.getJob(uploadJobId)) {
        // another execution of this job finished and handed off already
        logger.info({ videoAssetId, uploadJobId }, 'Upload already queued; skipping the transcode');
        return { skipped: 'handed-off' };
      }

      const processingJob = await getProcessingJobByVideoAssetId(videoAssetId);
      const pj = processingJob?.id;
      if (pj) await updateProcessingJobStatus(pj, { status: 'processing', progressPercent: 0 });
      if (asset.status !== 'processing') {
        await updateVideoAsset(videoAssetId, { status: 'processing' });
      }
      // once per run: BullMQ's retries and stalled re-runs of the stage do not start a new one
      if (job.attemptsStarted <= 1) await emit('processing.started', videoAssetId);

      let output: CompletedOutput | null = await findCompletedOutput(outputRoot, videoAssetId);
      const reused = output !== null;
      if (output) {
        // an earlier attempt finished FFmpeg and failed after it
        await note(
          pj,
          'transcode',
          `Reusing the finished transcode in ${path.basename(output.outputDir)}`,
        );
      } else {
        output = await runTranscode(job, filePath, pj);
        if (!output) return { skipped: 'stopped' };
      }

      await progress(job, pj, 65);
      if (!(await stillProcessing(videoAssetId))) {
        if (!reused) await dropOutput(outputRoot, videoAssetId, output.outputDir);
        else if (!(await getVideoAssetById(videoAssetId))) {
          await removeAssetOutput(outputRoot, videoAssetId);
        }
        return { skipped: 'stopped' };
      }

      await queues.uploadSegments.add(
        'upload-segments',
        {
          videoAssetId,
          uploadSessionId,
          outputDir: output.outputDir,
          thumbnailPaths: output.thumbnailPaths,
          durationMs: output.marker.durationMs,
          resolution: output.marker.resolution,
          ...(runId ? { runId } : {}),
        },
        { jobId: uploadJobId },
      );
      const queued = await queues.uploadSegments.getJob(uploadJobId);
      if (queued && queued.data.outputDir !== output.outputDir) {
        // a duplicate execution queued its own directory first, and that upload reads only it
        await removeOutput(output.outputDir);
        logger.warn(
          { videoAssetId, outputDir: output.outputDir },
          'Duplicate transcode; dropped its output',
        );
        return { skipped: 'duplicate' };
      }

      logger.info(
        { videoAssetId, jobId: job.id, thumbnailCount: output.thumbnailPaths.length },
        'Transcode job complete, enqueued upload-segments',
      );
      return { outputDir: output.outputDir };
    },
    { ...workerBase, concurrency: TRANSCODE_CONCURRENCY },
  );

  /** FFmpeg into a fresh run directory, then thumbnails, then the completion marker. */
  async function runTranscode(
    job: Job<TranscodeJobData>,
    filePath: string,
    pj: string | undefined,
  ): Promise<CompletedOutput | null> {
    const { videoAssetId } = job.data;
    const outputDir = await createRunDir(outputRoot, videoAssetId);
    await note(pj, 'transcode', `Starting transcode for ${path.basename(filePath)}`);

    const result = await transcode(filePath, outputDir, {
      // transcode progress is 0-60% of the pipeline
      onProgress: (percent) => progress(job, pj, Math.round(percent * 0.6)),
    });
    // saved before anything else can fail, so a later failure does not lose them
    await updateVideoAsset(videoAssetId, {
      durationMs: result.durationMs,
      resolution: result.resolution,
    });
    await note(
      pj,
      'transcode',
      `Probed source video: ${result.resolution} at ${result.durationMs}ms duration`,
    );
    await note(
      pj,
      'transcode',
      // the ladder is capped at the source height, so name what was made
      `FFmpeg transcoding: ${result.variantDirs.length} renditions (${result.variantDirs
        .map((dir) => path.basename(dir))
        .join(', ')})`,
    );
    await note(
      pj,
      'transcode',
      `Transcode complete: ${result.segmentCount} segments across ${result.variantDirs.length} renditions`,
    );

    if (!(await stillProcessing(videoAssetId))) {
      await dropOutput(outputRoot, videoAssetId, outputDir);
      return null;
    }

    // best effort per shot (see thumbnail-extractor.ts), so this cannot fail the video
    const thumbnailPaths = await extractThumbnails(filePath, result.durationMs, outputDir);
    await note(pj, 'transcode', `Extracted ${thumbnailPaths.length} thumbnails`);

    const marker = await writeCompletionMarker(outputDir, {
      durationMs: result.durationMs,
      resolution: result.resolution,
      thumbnails: thumbnailPaths.map((p) => path.basename(p)),
    });
    return { outputDir, marker, thumbnailPaths };
  }

  // ── upload segments ──

  const leaseRenewMs = opts.uploadLeaseRenewMs ?? UPLOAD_LEASE_RENEW_MS;

  /**
   * One execution of an upload stage run uploads at a time. BullMQ hands a
   * job whose lock expired to another execution without stopping the first,
   * which happens when the host freezes for longer than the lock (Redis
   * expires the lock by the wall clock, which jumps over the freeze), and
   * two executions would then upload and pin the same video twice. The
   * running execution holds this lease in Redis and renews it on a short
   * heartbeat; another execution waits while the lease is held, then checks
   * again whether there is anything left to upload.
   */
  async function holdUploadLease(job: Job<UploadSegmentsJobData>, jobToken: string | undefined) {
    // BullMQ renews locks per job id, and stops when any execution of the job
    // in this worker ends, so a duplicate that carries on after the first
    // execution would lose its lock and be failed as stalled. this execution
    // keeps its own lock alive while it waits and uploads.
    const lockMs = opts.workerOptions?.lockDuration ?? PIPELINE_LOCK_DURATION_MS;
    const keepLock = setInterval(
      () => {
        if (!jobToken) return;
        job.extendLock(jobToken, lockMs).then(
          (extended) => {
            if (!extended)
              logger.warn({ jobId: job.id }, 'This execution no longer holds the job lock');
          },
          (err: unknown) => logger.warn({ jobId: job.id, err }, 'Could not extend the job lock'),
        );
      },
      Math.min(leaseRenewMs, lockMs / 3),
    );
    try {
      return await claimUploadLease(job, keepLock);
    } catch (err) {
      clearInterval(keepLock);
      throw err;
    }
  }

  async function claimUploadLease(
    job: Job<UploadSegmentsJobData>,
    keepLock: ReturnType<typeof setInterval>,
  ) {
    const redis = await uploadWorker.client;
    // defining a command again on the same client replaces it with the same script
    redis.defineCommand('slubyClaimLease', { numberOfKeys: 1, lua: CLAIM_LEASE });
    redis.defineCommand('slubyReleaseLease', { numberOfKeys: 1, lua: RELEASE_LEASE });
    const key = `${opts.prefix ?? 'bull'}:upload-segments:${job.id}:lease`;
    const token = randomUUID();
    const ttl = String(3 * leaseRenewMs);
    const claim = async () => (await redis.runCommand('slubyClaimLease', [key, token, ttl])) === 1;

    // a redelivered job may be a duplicate of an execution still running on a
    // host that just woke up: give it a renewal to show it is alive
    if (job.attemptsStarted > 1) await pauseThroughFreezes(1.5 * leaseRenewMs);
    if (!(await claim())) {
      logger.warn(
        { videoAssetId: job.data.videoAssetId, jobId: job.id },
        'Another execution is uploading this run to Sia; waiting for it',
      );
      do await pauseThroughFreezes(leaseRenewMs);
      while (!(await claim()));
    }

    let lost = false;
    const renewal = setInterval(() => {
      claim().then(
        (held) => {
          if (held || lost) return;
          lost = true;
          logger.warn(
            { videoAssetId: job.data.videoAssetId, jobId: job.id },
            'Another execution took over this Sia upload; stopping at the next checkpoint',
          );
        },
        (err: unknown) => logger.warn({ jobId: job.id, err }, 'Could not renew the upload lease'),
      );
    }, leaseRenewMs);
    return {
      lost: () => lost,
      release: async () => {
        clearInterval(renewal);
        clearInterval(keepLock);
        try {
          await redis.runCommand('slubyReleaseLease', [key, token]);
        } catch (err) {
          // it runs out by itself after three renewals
          logger.warn({ jobId: job.id, err }, 'Could not release the upload lease');
        }
      },
    };
  }

  const uploadWorker = new Worker<UploadSegmentsJobData>(
    'upload-segments',
    async (job, jobToken) => {
      const lease = await holdUploadLease(job, jobToken);
      try {
        return await uploadStage(job, lease);
      } finally {
        await lease.release();
      }
    },
    { ...workerBase, concurrency: 4 },
  );

  async function uploadStage(job: Job<UploadSegmentsJobData>, lease: { lost: () => boolean }) {
    const { videoAssetId, uploadSessionId, outputDir, thumbnailPaths, runId } = job.data;
    logger.info({ videoAssetId, jobId: job.id, outputDir }, 'Starting upload-segments job');

    const asset = await getVideoAssetById(videoAssetId);
    if (!asset) {
      await removeAssetOutput(outputRoot, videoAssetId);
      logger.info({ videoAssetId }, 'Asset was deleted; skipping the Sia upload');
      return { skipped: 'deleted' };
    }
    if (asset.status !== 'processing') {
      logger.info(
        { videoAssetId, status: asset.status },
        'Asset is not processing; skipping the Sia upload',
      );
      return { skipped: asset.status };
    }
    const finalizeJobId = stageJobId('finalize', videoAssetId, runId);
    if (await queues.finalize.getJob(finalizeJobId)) {
      logger.info(
        { videoAssetId, finalizeJobId },
        'Finalize already queued; skipping the Sia upload',
      );
      return { skipped: 'handed-off' };
    }

    const processingJob = await getProcessingJobByVideoAssetId(videoAssetId);
    const pj = processingJob?.id;
    if (pj) await updateProcessingJobStatus(pj, { status: 'processing' });
    if (job.data.startsRun && job.attemptsStarted <= 1) {
      await emit('processing.started', videoAssetId);
    }
    // read before the upload, so nothing that can fail runs between it and the hand-off
    const durationMs = job.data.durationMs ?? asset.durationMs ?? 0;
    const resolution = job.data.resolution ?? asset.resolution ?? '';
    await note(pj, 'upload', 'Uploading segments to Sia');

    let result: Awaited<ReturnType<typeof uploadSegments>>;
    try {
      result = await uploadSegments(outputDir, {
        thumbnailPaths,
        ledger: runLedger(videoAssetId, runKey(runId)),
        checkpoint: async () => {
          if (lease.lost()) throw new LeaseLost(videoAssetId);
          if (!(await stillProcessing(videoAssetId))) throw new StageStopped(videoAssetId);
        },
        // the Sia upload is 65-90% of the pipeline
        onProgress: (uploaded, total) =>
          void progress(job, pj, 65 + Math.round((uploaded / total) * 25)),
      });
    } catch (err) {
      if (err instanceof LeaseLost) {
        // the uploader released what it pinned; the execution holding the lease carries on
        logger.info({ videoAssetId }, 'Left the Sia upload to the execution that took it over');
        return { skipped: 'superseded' };
      }
      if (!(err instanceof StageStopped)) throw err;
      // the uploader already released what it pinned; a failed asset keeps its output for a retry
      if (!(await getVideoAssetById(videoAssetId)))
        await removeAssetOutput(outputRoot, videoAssetId);
      logger.info({ videoAssetId }, 'Asset left processing during the Sia upload; stopped');
      return { skipped: 'stopped' };
    }

    // a failure from here on leaves the objects recorded as uploading: the
    // next attempt uploads again and its finalize, or the gc sweep, releases them
    await finalizeQueueAdd(job, {
      videoAssetId,
      ...(uploadSessionId ? { uploadSessionId } : {}),
      ...(runId ? { runId } : {}),
      manifestObjectId: result.masterManifestObjectId,
      thumbnailObjectIds: result.thumbnailObjectIds,
      durationMs,
      resolution,
      segmentCount: result.totalSegments,
      totalStorageBytes: result.totalBytes,
      storageRecords: result.storageRecords,
      siaObjectIds: result.allObjectIds,
    });
    await note(
      pj,
      'upload',
      `All segments uploaded: ${result.totalSegments} segments per rendition, ${result.totalBytes} bytes; master manifest ${result.masterManifestObjectId}`,
    );
    logger.info(
      { videoAssetId, jobId: job.id, masterManifestObjectId: result.masterManifestObjectId },
      'Upload-segments job complete, enqueued finalize',
    );
  }

  async function finalizeQueueAdd(job: Job<UploadSegmentsJobData>, data: FinalizeJobData) {
    await queues.finalize.add('finalize', data, {
      jobId: stageJobId('finalize', job.data.videoAssetId, job.data.runId),
    });
  }

  // ── finalize ──

  const finalizeWorker = new Worker<FinalizeJobData>(
    'finalize',
    async (job) => {
      const d = job.data;
      const { videoAssetId } = d;
      logger.info({ videoAssetId, jobId: job.id }, 'Starting finalize job');
      const runObjectIds = [
        ...new Set(
          [
            d.manifestObjectId,
            ...d.thumbnailObjectIds,
            ...(d.siaObjectIds ?? []),
            ...d.storageRecords.artifacts.map((a) => a.objectId),
          ].filter(Boolean),
        ),
      ];

      const processingJob = await getProcessingJobByVideoAssetId(videoAssetId);
      const pj = processingJob?.id;
      await progress(job, pj, 90);
      await note(pj, 'finalize', 'Finalizing video asset');

      const result = await finalizeAssetStorage(videoAssetId, {
        records: d.storageRecords,
        manifestObjectId: d.manifestObjectId,
        thumbnailObjectIds: d.thumbnailObjectIds,
        siaObjectIds: d.siaObjectIds ?? runObjectIds,
        durationMs: d.durationMs,
        resolution: d.resolution,
        segmentCount: d.segmentCount,
        totalStorageBytes: d.totalStorageBytes,
        processingJobId: pj,
      });

      if (result.outcome === 'gone' || result.outcome === 'not-processing') {
        // deleted while processing, or a stale run: nothing will use these objects
        logger.warn(
          { videoAssetId, outcome: result.outcome, objects: runObjectIds.length },
          'Asset is not waiting for this run; unpinning its output',
        );
        await releaseObjects(runObjectIds);
        if (result.outcome === 'gone') await removeAssetOutput(outputRoot, videoAssetId);
        return { skipped: result.outcome };
      }

      if (result.outcome === 'ready') {
        const done = result.job;
        if (done?.startedAt && done.completedAt) {
          processingDurationSeconds.observe(
            (done.completedAt.getTime() - done.startedAt.getTime()) / 1000,
          );
        }
        await note(
          pj,
          'finalize',
          `Persisted ${d.storageRecords.renditions.length} renditions and ${d.storageRecords.artifacts.length} artifacts`,
        );
      }

      // everything below is best effort: the asset is ready either way, and a
      // re-run of this job (already-ready) repeats it, so asset.ready is sent
      // at least once
      await note(pj, 'finalize', 'Asset ready');
      await emit('asset.ready', videoAssetId, {
        manifest_object_id: d.manifestObjectId,
        thumbnail_object_ids: d.thumbnailObjectIds,
        duration_ms: d.durationMs,
        resolution: d.resolution,
        segment_count: d.segmentCount,
        total_storage_bytes: d.totalStorageBytes,
        status: 'ready',
      });

      try {
        await unpinReleasedObjects({ videoAssetId });
      } catch (err) {
        logger.warn({ videoAssetId, err }, 'Could not unpin replaced objects; the gc sweep will');
      }

      // the small, hot objects (master, variant playlists, thumbnails), so the
      // first playback is served from memory; the big data files are read by
      // byte range and would blow the cache budget
      try {
        const playlistIds = d.storageRecords.renditions.map((r) => r.playlistObjectId);
        const warmIds = [
          ...new Set([d.manifestObjectId, ...playlistIds, ...d.thumbnailObjectIds].filter(Boolean)),
        ];
        await warmObjects(warmIds);
        // GET /v1/stream/:id/master.m3u8 reads the master from the manifest cache
        if (d.manifestObjectId) await warmObjects([d.manifestObjectId], { isManifest: true });
        await note(
          pj,
          'finalize',
          `Warmed ${warmIds.length} manifest/thumbnail objects into cache`,
        );
      } catch (err) {
        logger.warn({ videoAssetId, err }, 'Cache warming failed (non-fatal)');
      }

      try {
        await removeAssetOutput(outputRoot, videoAssetId);
      } catch (err) {
        logger.warn(
          { videoAssetId, err },
          'Failed to clean up transcode output; the gc sweep will',
        );
      }
      // the asset is ready, so nothing will transcode the source again. a failed
      // asset never gets here and keeps its source for a retry
      if (d.uploadSessionId) {
        await removeSessionSource(
          d.uploadSessionId,
          { getUploadSession: getUploadSessionById, log: logger },
          { videoAssetId },
        );
      }
      logger.info({ videoAssetId, jobId: job.id }, 'Finalize job complete');
    },
    { ...workerBase, concurrency: 4 },
  );

  // ── failures ──

  const delays = opts.failureWriteDelaysMs ?? FAILURE_WRITE_DELAYS_MS;

  const onFailed =
    (stage: 'transcode' | 'upload' | 'finalize') =>
    (job: Job<{ videoAssetId: string }> | undefined, error: Error) => {
      if (!job) return;
      recordFailure(stage, job, error, delays, emit).catch((err: unknown) => {
        logger.error(
          { stage, jobId: job.id, videoAssetId: job.data.videoAssetId, err },
          'Could not record a pipeline failure; the asset may stay processing',
        );
      });
    };

  transcodeWorker.on('failed', onFailed('transcode'));
  uploadWorker.on('failed', onFailed('upload'));
  finalizeWorker.on('failed', onFailed('finalize'));
  // a lock BullMQ could not renew ("could not renew lock for job ...") comes
  // here; without a listener it only reaches stderr, outside the json log
  for (const [stage, worker] of [
    ['transcode', transcodeWorker],
    ['upload', uploadWorker],
    ['finalize', finalizeWorker],
  ] as const) {
    worker.on('error', (err) => logger.error({ stage, err }, 'Pipeline worker error'));
  }

  return {
    transcode: transcodeWorker,
    uploadSegments: uploadWorker,
    finalize: finalizeWorker,
    close: async () => {
      await Promise.all([transcodeWorker.close(), uploadWorker.close(), finalizeWorker.close()]);
    },
  };
}

/**
 * Whether BullMQ gave up on the job. The attempt count alone misses the
 * failures it does not retry: an UnrecoverableError, which it raises itself
 * for a job that stalled more often than maxStalledCount. BullMQ sets
 * `finishedOn` on the job exactly when it moves it to failed for good.
 */
export function isFinalFailure(job: Pick<Job, 'finishedOn'>, error: Error): boolean {
  return job.finishedOn != null || error.name === 'UnrecoverableError';
}

async function recordFailure(
  stage: 'transcode' | 'upload' | 'finalize',
  job: Job<{ videoAssetId: string }>,
  error: Error,
  delays: number[],
  emit: AssetEventEmitter,
): Promise<void> {
  const { videoAssetId } = job.data;
  const final = isFinalFailure(job, error);
  logger.error(
    { stage, jobId: job.id, videoAssetId, attempt: job.attemptsMade, final, error: error.message },
    'Pipeline job failed',
  );

  // the database is a likely reason the job failed, so these writes are retried
  let failedAsset = false;
  await withRetries(delays, async () => {
    const pj = (await getProcessingJobByVideoAssetId(videoAssetId))?.id;
    if (!final) {
      if (pj && (await stillProcessing(videoAssetId)))
        await recordProcessingRetry(pj, error.message);
      return;
    }
    failedAsset = failedAsset || (await failProcessingAsset(videoAssetId));
    if (failedAsset && pj) {
      await updateProcessingJobStatus(pj, { status: 'failed', errorMessage: error.message });
    }
  });
  if (failedAsset) {
    await emit('asset.errored', videoAssetId, { stage, error: error.message });
  }
}

async function withRetries(delays: number[], fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt >= delays.length) throw err;
      logger.warn({ err, attempt: attempt + 1 }, 'Recording a pipeline failure failed; retrying');
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

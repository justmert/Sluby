import { Worker, type Job } from 'bullmq';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  redisConnection,
  uploadSegmentsQueue,
  finalizeQueue,
  type TranscodeJobData,
  type UploadSegmentsJobData,
  type FinalizeJobData,
} from './bull-config.js';
import { env } from '../config/env.js';
import pino from 'pino';

// ── Module imports ──
import { transcode } from '../transcode/ffmpeg-runner.js';
import { extractThumbnails } from '../transcode/thumbnail-extractor.js';
import { uploadSegments } from '../storage/segment-uploader.js';
import { warmObjects } from '../storage/blob-manager.js';
import { updateVideoAsset, getVideoAssetById } from '../db/queries/assets.js';
import { persistStorageRecords } from '../db/queries/storage-records.js';
import {
  updateProcessingJobStatus,
  updateProcessingJobProgress,
  getProcessingJobByUploadSessionId,
  appendProcessingLog,
} from '../db/queries/jobs.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import {
  findEndpointsForEvent,
  createWebhookDelivery,
} from '../db/queries/webhooks.js';

const logger = pino({ name: 'queue-processors' });

// ── Webhook dispatcher singleton ──
const webhookDispatcher = new WebhookDispatcher({
  getActiveWebhooksForEvent: async (event: string) => {
    const endpoints = await findEndpointsForEvent(event);
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      secret: ep.secret,
      isActive: ep.isActive,
    }));
  },
  recordDelivery: async (data) => {
    await createWebhookDelivery({
      webhookEndpointId: data.webhookEndpointId,
      eventType: data.eventType,
      payload: data.payload,
      statusCode: data.statusCode,
      responseBody: data.responseBody,
      retryCount: data.retryCount,
    });
  },
});

// ──────────────────────────────────────────
// Transcode Worker
// ──────────────────────────────────────────

/**
 * Processes transcode jobs.
 * Runs FFmpeg to produce multi-rendition HLS/fMP4 output,
 * extracts thumbnails, then enqueues an upload-segments job.
 */
export const transcodeWorker = new Worker<TranscodeJobData>(
  'transcode',
  async (job: Job<TranscodeJobData>) => {
    const { videoAssetId, uploadSessionId, filePath } = job.data;
    logger.info({ videoAssetId, jobId: job.id }, 'Starting transcode job');

    // Look up the processing job row for DB updates by ID
    const processingJob = await getProcessingJobByUploadSessionId(uploadSessionId);

    // Mark job as processing in DB
    if (processingJob) {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'processing',
        progressPercent: 0,
      });
    }

    // Update video asset status
    await updateVideoAsset(videoAssetId, { status: 'processing' });

    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'transcode', `Starting transcode for ${path.basename(filePath)}`);
    }

    // Run FFmpeg transcode
    const outputDir = path.join(env.TRANSCODE_OUTPUT_DIR, videoAssetId);

    const result = await transcode(filePath, outputDir, {
      onProgress: async (percent) => {
        // Scale transcode progress to 0-60% of overall pipeline
        const scaledPercent = Math.round(percent * 0.6);
        await job.updateProgress(scaledPercent);
        if (processingJob) {
          await updateProcessingJobProgress(processingJob.id, scaledPercent);
        }
      },
    });

    logger.info({ videoAssetId, durationMs: result.durationMs, resolution: result.resolution }, 'Transcode complete, extracting thumbnails');

    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'transcode', `Probed source video: ${result.resolution} at ${result.durationMs}ms duration`);
      await appendProcessingLog(processingJob.id, 'transcode', 'FFmpeg transcoding: 4 renditions (1080p, 720p, 540p, 360p)');
      await appendProcessingLog(processingJob.id, 'transcode', `Transcode complete: ${result.segmentCount} segments`);
    }

    // Extract thumbnails to disk only — they get uploaded together with
    // the variant playlists in the upload-segments worker (one packed
    // Sia operation instead of N separate uploads).
    const thumbnailPaths = await extractThumbnails(
      filePath,
      result.durationMs,
      outputDir,
    );

    // Update progress to 65% (transcode done, thumbnails extracted)
    await job.updateProgress(65);
    if (processingJob) {
      await updateProcessingJobProgress(processingJob.id, 65);
      await appendProcessingLog(processingJob.id, 'transcode', `Extracted ${thumbnailPaths.length} thumbnails`);
    }

    // Save transcode metadata to DB so downstream workers can access it
    await updateVideoAsset(videoAssetId, {
      durationMs: result.durationMs,
      resolution: result.resolution,
    });

    // Fetch the video asset to get accessTier
    const videoAsset = await getVideoAssetById(videoAssetId);

    // Enqueue the segment upload job, passing thumbnail file paths so
    // the upload-segments worker can pack them with the manifests.
    await uploadSegmentsQueue.add('upload-segments', {
      videoAssetId,
      uploadSessionId,
      outputDir,
      accessTier: videoAsset?.accessTier ?? 'public',
      thumbnailPaths,
    });

    logger.info(
      { videoAssetId, jobId: job.id, thumbnailCount: thumbnailPaths.length },
      'Transcode job complete, enqueued upload-segments',
    );

    // Return metadata for potential downstream use
    return {
      outputDir,
      durationMs: result.durationMs,
      resolution: result.resolution,
      segmentCount: result.segmentCount,
      thumbnailPaths,
    };
  },
  {
    connection: redisConnection,
    concurrency: 2,
    limiter: {
      max: 4,
      duration: 60_000,
    },
  },
);

transcodeWorker.on('failed', async (job, error) => {
  if (!job) return;
  logger.error(
    { jobId: job.id, error: error.message },
    'Transcode job failed',
  );

  const processingJob = await getProcessingJobByUploadSessionId(job.data.uploadSessionId);
  if (processingJob) {
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'failed',
        errorMessage: error.message,
      });
    } else {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'retrying',
        errorMessage: error.message,
      });
    }
  }

  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await updateVideoAsset(job.data.videoAssetId, { status: 'failed' });
  }
});

// ──────────────────────────────────────────
// Upload Segments Worker
// ──────────────────────────────────────────

/**
 * Processes upload-segments jobs.
 * Reads the HLS output directory, uploads each segment and manifest
 * to Sia, rewrites manifests with object IDs, then enqueues a
 * finalize job.
 */
export const uploadSegmentsWorker = new Worker<UploadSegmentsJobData>(
  'upload-segments',
  async (job: Job<UploadSegmentsJobData>) => {
    const { videoAssetId, uploadSessionId, outputDir, accessTier, thumbnailPaths } = job.data;
    logger.info(
      { videoAssetId, jobId: job.id, accessTier },
      'Starting upload-segments job',
    );

    const processingJob = await getProcessingJobByUploadSessionId(uploadSessionId);

    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'upload', 'Uploading segments to Sia');
    }

    // Upload segments to Sia. Concurrency is bounded by host-pool size
    // — each upload uses ~12 host streams, so over-parallelism causes
    // "no more hosts available". Default tuned for Zen testnet's ~13
    // contracted hosts. On mainnet (hundreds of hosts) bump this via
    // SIA_UPLOAD_CONCURRENCY.
    const result = await uploadSegments(outputDir, {
      concurrency: parseInt(process.env.SIA_UPLOAD_CONCURRENCY ?? '3', 10),
      thumbnailPaths,
      onProgress: async (uploaded, total) => {
        // Scale upload progress to 65-90% of overall pipeline
        const percent = 65 + Math.round((uploaded / total) * 25);
        await job.updateProgress(percent);
        if (processingJob) {
          await updateProcessingJobProgress(processingJob.id, percent);
        }
      },
    });

    const masterManifestObjectId = result.masterManifestObjectId;
    const totalSegments = result.totalSegments;
    const totalStorageBytes = result.totalBytes;
    const thumbnailObjectIds = result.thumbnailObjectIds;

    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'upload', `All segments uploaded: ${totalSegments} segments, ${totalStorageBytes} bytes`);
    }

    // Read duration and resolution from the video asset
    const videoAsset = await getVideoAssetById(videoAssetId);
    const durationMs = videoAsset?.durationMs ?? 0;
    const resolution = videoAsset?.resolution ?? '';

    // Enqueue the finalize job
    await finalizeQueue.add('finalize', {
      videoAssetId,
      uploadSessionId,
      manifestObjectId: masterManifestObjectId,
      thumbnailObjectIds,
      durationMs,
      resolution,
      segmentCount: totalSegments,
      totalStorageBytes,
      storageRecords: result.storageRecords,
      ...(result.allObjectIds ? { siaObjectIds: result.allObjectIds } : {}),
    });

    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'upload', `Master manifest uploaded: ${masterManifestObjectId}`);
    }

    logger.info(
      { videoAssetId, jobId: job.id, masterManifestObjectId, totalSegments },
      'Upload-segments job complete, enqueued finalize',
    );
  },
  {
    connection: redisConnection,
    concurrency: 4,
  },
);

uploadSegmentsWorker.on('failed', async (job, error) => {
  if (!job) return;
  logger.error(
    { jobId: job.id, error: error.message },
    'Upload-segments job failed',
  );

  const processingJob = await getProcessingJobByUploadSessionId(job.data.uploadSessionId);
  if (processingJob) {
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'failed',
        errorMessage: error.message,
      });
    } else {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'retrying',
        errorMessage: error.message,
      });
    }
  }

  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await updateVideoAsset(job.data.videoAssetId, { status: 'failed' });
  }
});

// ──────────────────────────────────────────
// Finalize Worker
// ──────────────────────────────────────────

/**
 * Processes finalize jobs.
 * Updates the VideoAsset in the local DB and fires the "asset.ready" webhook.
 */
export const finalizeWorker = new Worker<FinalizeJobData>(
  'finalize',
  async (job: Job<FinalizeJobData>) => {
    const {
      videoAssetId,
      uploadSessionId,
      manifestObjectId,
      thumbnailObjectIds,
      siaObjectIds,
      durationMs,
      resolution,
      segmentCount,
      totalStorageBytes,
      storageRecords,
    } = job.data;
    logger.info({ videoAssetId, jobId: job.id }, 'Starting finalize job');

    // Look up the processing job for logging
    const processingJob = await getProcessingJobByUploadSessionId(uploadSessionId);

    if (processingJob) {
      await updateProcessingJobProgress(processingJob.id, 90);
      await appendProcessingLog(processingJob.id, 'finalize', 'Finalizing video asset');
    }

    // Persist the normalized rendition + artifact mapping (each Sia
    // Object ID → asset + rendition + role) before the asset is marked
    // ready, so anything reacting to "ready" sees the full storage graph.
    // Idempotent, so a finalize retry re-persists cleanly.
    if (storageRecords) {
      await persistStorageRecords(videoAssetId, storageRecords);
      if (processingJob) {
        await appendProcessingLog(
          processingJob.id,
          'finalize',
          `Persisted ${storageRecords.renditions.length} renditions and ${storageRecords.artifacts.length} artifacts`,
        );
      }
    }

    // Update local DB with final metadata
    await updateVideoAsset(videoAssetId, {
      manifestObjectId,
      thumbnailObjectIds,
      siaObjectIds,
      durationMs,
      resolution,
      segmentCount,
      totalStorageBytes,
      status: 'ready',
    });

    // Mark the processing job as completed
    if (processingJob) {
      await appendProcessingLog(processingJob.id, 'finalize', 'Asset ready');
      await updateProcessingJobStatus(processingJob.id, {
        status: 'completed',
        progressPercent: 100,
      });
    }

    // Cache warming: prefetch the small, hot objects (master manifest,
    // variant playlists, thumbnails) so the first playback after a
    // transcode is served from RAM instead of a cold Sia read. The big
    // rendition data files are intentionally not warmed — they are served
    // by byte-range and would blow the cache budget. Best-effort.
    try {
      const playlistIds =
        storageRecords?.renditions.map((r) => r.playlistObjectId) ?? [];
      const warmIds = [
        ...new Set(
          [manifestObjectId, ...playlistIds, ...thumbnailObjectIds].filter(
            Boolean,
          ),
        ),
      ];
      await warmObjects(warmIds);
      if (processingJob) {
        await appendProcessingLog(
          processingJob.id,
          'finalize',
          `Warmed ${warmIds.length} manifest/thumbnail objects into cache`,
        );
      }
    } catch (err) {
      logger.warn({ videoAssetId, err }, 'Cache warming failed (non-fatal)');
    }

    // Dispatch "asset.ready" webhook
    await webhookDispatcher.dispatch('asset.ready', {
      video_asset_id: videoAssetId,
      manifest_object_id: manifestObjectId,
      thumbnail_object_ids: thumbnailObjectIds,
      duration_ms: durationMs,
      resolution,
      segment_count: segmentCount,
      total_storage_bytes: totalStorageBytes,
      status: 'ready',
    });

    // Clean up the transcode output directory
    const outputDir = path.join(env.TRANSCODE_OUTPUT_DIR, videoAssetId);
    try {
      await rm(outputDir, { recursive: true, force: true });
      logger.info({ outputDir }, 'Cleaned up transcode output');
    } catch (err) {
      logger.warn({ outputDir, err }, 'Failed to clean up transcode output');
    }

    logger.info({ videoAssetId, jobId: job.id }, 'Finalize job complete');
  },
  {
    connection: redisConnection,
    concurrency: 4,
  },
);

finalizeWorker.on('failed', async (job, error) => {
  if (!job) return;
  logger.error(
    { jobId: job.id, error: error.message },
    'Finalize job failed',
  );

  const processingJob = await getProcessingJobByUploadSessionId(job.data.uploadSessionId);
  if (processingJob) {
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'failed',
        errorMessage: error.message,
      });
    } else {
      await updateProcessingJobStatus(processingJob.id, {
        status: 'retrying',
        errorMessage: error.message,
      });
    }
  }

  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await updateVideoAsset(job.data.videoAssetId, { status: 'failed' });
  }
});

// ──────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────

/**
 * Gracefully shut down all workers.
 */
export async function closeWorkers(): Promise<void> {
  await Promise.all([
    transcodeWorker.close(),
    uploadSegmentsWorker.close(),
    finalizeWorker.close(),
  ]);
}

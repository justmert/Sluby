/**
 * @deprecated This module is superseded by `../queue/processors.ts` which is the
 * canonical entry point for video processing workers. It uses three separate BullMQ
 * queues (transcode, upload-segments, finalize) with full DB bookkeeping, encryption
 * support, on-chain finalization, and webhook dispatch.
 *
 * This file is retained for reference but should not be used directly.
 * See `../queue/processors.ts` for the active implementation.
 */
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { Job, Worker } from 'bullmq';
import { transcode } from './ffmpeg-runner.js';
import { extractAndUploadThumbnails } from './thumbnail-extractor.js';
import { uploadSegments } from '../storage/segment-uploader.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export interface TranscodeJobData {
  videoAssetId: string;
  uploadSessionId: string;
  filePath: string;
  creatorAddress: string;
  accessTier: string;
}

export interface UploadSegmentsJobData {
  videoAssetId: string;
  outputDir: string;
  inputPath: string;
  durationMs: number;
  resolution: string;
  creatorAddress: string;
  accessTier: string;
}

export interface FinalizeJobData {
  videoAssetId: string;
  manifestObjectId: string;
  thumbnailObjectIds: string[];
  durationMs: number;
  resolution: string;
  totalSegments: number;
  totalStorageBytes: number;
  creatorAddress: string;
}

type JobData = TranscodeJobData | UploadSegmentsJobData | FinalizeJobData;

export function createTranscodeWorker(
  redisConnection: { host: string; port: number },
  handlers: {
    onTranscodeComplete?: (job: Job<UploadSegmentsJobData>) => void;
    onFinalizeComplete?: (data: FinalizeJobData) => void;
    updateJobProgress?: (videoAssetId: string, percent: number, stage: string) => Promise<void>;
    updateVideoStatus?: (videoAssetId: string, status: string) => Promise<void>;
    dispatchWebhook?: (event: string, data: Record<string, unknown>) => Promise<void>;
    addJob?: (name: string, data: JobData) => Promise<void>;
  },
): Worker {
  const worker = new Worker<JobData>(
    'video-processing',
    async (job) => {
      switch (job.name) {
        case 'transcode':
          return handleTranscode(job as Job<TranscodeJobData>, handlers);
        case 'upload-segments':
          return handleUploadSegments(job as Job<UploadSegmentsJobData>, handlers);
        case 'finalize':
          return handleFinalize(job as Job<FinalizeJobData>, handlers);
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Job failed');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Job completed');
  });

  return worker;
}

async function handleTranscode(
  job: Job<TranscodeJobData>,
  handlers: Parameters<typeof createTranscodeWorker>[1],
): Promise<void> {
  const { videoAssetId, filePath, creatorAddress, accessTier } = job.data;
  const outputDir = path.join(env.TRANSCODE_OUTPUT_DIR, videoAssetId);

  logger.info({ videoAssetId, filePath }, 'Starting transcode');

  await handlers.updateVideoStatus?.(videoAssetId, 'processing');
  await handlers.dispatchWebhook?.('processing.started', { video_asset_id: videoAssetId });

  const result = await transcode(filePath, outputDir, {
    onProgress: async (percent) => {
      await job.updateProgress(percent);
      await handlers.updateJobProgress?.(videoAssetId, percent, 'transcoding');
      if (percent % 10 === 0) {
        await handlers.dispatchWebhook?.('processing.progress', {
          video_asset_id: videoAssetId,
          progress_percent: percent,
          stage: 'transcoding',
        });
      }
    },
  });

  logger.info({ videoAssetId, result }, 'Transcode complete, enqueueing segment upload');

  // Enqueue segment upload job
  await handlers.addJob?.('upload-segments', {
    videoAssetId,
    outputDir,
    inputPath: filePath,
    durationMs: result.durationMs,
    resolution: result.resolution,
    creatorAddress,
    accessTier,
  });
}

async function handleUploadSegments(
  job: Job<UploadSegmentsJobData>,
  handlers: Parameters<typeof createTranscodeWorker>[1],
): Promise<void> {
  const { videoAssetId, outputDir, inputPath, durationMs, resolution, creatorAddress } = job.data;

  logger.info({ videoAssetId, outputDir }, 'Starting segment upload to Sia');

  const uploadResult = await uploadSegments(outputDir, {
    concurrency: 10,
    onProgress: async (uploaded, total) => {
      const percent = Math.round((uploaded / total) * 100);
      await job.updateProgress(percent);
      await handlers.updateJobProgress?.(videoAssetId, percent, 'uploading');
    },
  });

  // Extract and upload thumbnails
  logger.info({ videoAssetId }, 'Extracting thumbnails');
  const thumbnailObjectIds = await extractAndUploadThumbnails(inputPath, durationMs, outputDir);

  logger.info({ videoAssetId, uploadResult, thumbnailObjectIds }, 'Segments and thumbnails uploaded');

  // Enqueue finalize job
  await handlers.addJob?.('finalize', {
    videoAssetId,
    manifestObjectId: uploadResult.masterManifestObjectId,
    thumbnailObjectIds,
    durationMs,
    resolution,
    totalSegments: uploadResult.totalSegments,
    totalStorageBytes: uploadResult.totalBytes,
    creatorAddress,
  });
}

async function handleFinalize(
  job: Job<FinalizeJobData>,
  handlers: Parameters<typeof createTranscodeWorker>[1],
): Promise<void> {
  const data = job.data;

  logger.info({ videoAssetId: data.videoAssetId, manifestObjectId: data.manifestObjectId }, 'Finalizing video');

  await handlers.onFinalizeComplete?.(data);

  await handlers.dispatchWebhook?.('asset.ready', {
    video_asset_id: data.videoAssetId,
    manifest_object_id: data.manifestObjectId,
    duration_ms: data.durationMs,
    resolution: data.resolution,
    status: 'ready',
  });

  // Clean up transcode output directory
  const outputDir = path.join(env.TRANSCODE_OUTPUT_DIR, data.videoAssetId);
  try {
    await rm(outputDir, { recursive: true, force: true });
    logger.info({ outputDir }, 'Cleaned up transcode output');
  } catch (err) {
    logger.warn({ outputDir, err }, 'Failed to clean up transcode output');
  }
}

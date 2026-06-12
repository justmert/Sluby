import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';

/**
 * Parse the REDIS_URL into an ioredis-compatible connection object.
 */
function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) || 0 : 0,
  };
}

export const redisConnection: ConnectionOptions = parseRedisUrl(env.REDIS_URL);

// ──────────────────────────────────────────
// Job data types
// ──────────────────────────────────────────

export interface TranscodeJobData {
  videoAssetId: string;
  uploadSessionId: string;
  filePath: string;
}

export interface UploadSegmentsJobData {
  videoAssetId: string;
  uploadSessionId: string;
  outputDir: string;
  accessTier: string;
}

export interface FinalizeJobData {
  videoAssetId: string;
  uploadSessionId: string;
  manifestObjectId: string;
  thumbnailObjectIds: string[];
  siaObjectIds?: string[];
  durationMs: number;
  resolution: string;
  segmentCount: number;
  totalStorageBytes: number;
}

export type VideoProcessingJobData =
  | TranscodeJobData
  | UploadSegmentsJobData
  | FinalizeJobData;

// ──────────────────────────────────────────
// Queue definitions
// ──────────────────────────────────────────

/**
 * Queue for transcoding raw video files into multi-rendition HLS/fMP4.
 * Jobs: { videoAssetId, uploadSessionId, filePath }
 */
export const transcodeQueue = new Queue<TranscodeJobData>('transcode', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30_000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/**
 * Queue for uploading HLS segments to Sia.
 * Jobs: { videoAssetId, outputDir, accessTier }
 */
export const uploadSegmentsQueue = new Queue<UploadSegmentsJobData>(
  'upload-segments',
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30_000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  },
);

/**
 * Queue for finalizing processed videos.
 * Updates the VideoAsset and fires the "asset.ready" webhook.
 * Jobs: { videoAssetId, manifestObjectId, thumbnailObjectIds, ... }
 */
export const finalizeQueue = new Queue<FinalizeJobData>('finalize', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10_000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/**
 * Gracefully close all queue connections.
 * Call during server shutdown.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    transcodeQueue.close(),
    uploadSegmentsQueue.close(),
    finalizeQueue.close(),
  ]);
}

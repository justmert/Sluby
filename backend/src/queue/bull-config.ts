import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import type { StorageRecords } from '../storage/artifact-records.js';

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
  /**
   * Local file paths of thumbnails extracted by the transcode worker.
   * Uploaded as part of the same packed Sia batch as the variant
   * playlists, so we save host-stream count vs. uploading separately.
   */
  thumbnailPaths?: string[];
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
  /** Normalized rendition + artifact mapping to persist for this asset. */
  storageRecords?: StorageRecords;
}

export interface ReconcileJobData {
  /** How the run was initiated — a scheduled sweep or a manual trigger. */
  trigger: 'scheduled' | 'manual';
}

/**
 * Deletion queue jobs. `delete` unpins one asset's objects and removes its
 * row; `gc` sweeps for soft-deleted assets whose deletion never finished and
 * re-enqueues a `delete` for each.
 */
export type DeletionJobData =
  { kind: 'delete'; videoAssetId: string; objectIds: string[] } | { kind: 'gc' };

export type VideoProcessingJobData = TranscodeJobData | UploadSegmentsJobData | FinalizeJobData;

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
export const uploadSegmentsQueue = new Queue<UploadSegmentsJobData>('upload-segments', {
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
 * Queue for background reconciliation runs comparing the DB's tracked
 * objects against the indexer's pinned inventory. Fed by a repeatable
 * scheduled job and by on-demand API triggers.
 */
export const reconcileQueue = new Queue<ReconcileJobData>('reconcile', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

/**
 * Queue for asynchronous asset deletion: unpinning an asset's Sia objects,
 * pruning slabs, and removing its row, plus a repeatable GC sweep that
 * re-drives deletions that never finished.
 */
export const deletionQueue = new Queue<DeletionJobData>('deletion', {
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
 * Gracefully close all queue connections.
 * Call during server shutdown.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    transcodeQueue.close(),
    uploadSegmentsQueue.close(),
    finalizeQueue.close(),
    reconcileQueue.close(),
    deletionQueue.close(),
  ]);
}

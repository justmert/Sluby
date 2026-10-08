import { Queue, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import type { StorageRecords } from '../storage/artifact-records.js';
import { RECONCILE_JOB_OPTIONS } from '../reconcile/enqueue.js';
import { WEBHOOK_QUEUE, webhookJobOptions, type WebhookJobData } from '../webhooks/delivery.js';

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

export interface TranscodeJobData {
  videoAssetId: string;
  uploadSessionId: string;
  filePath: string;
  /** The processing attempt this job belongs to, see stageJobId. */
  runId?: string;
}

export interface UploadSegmentsJobData {
  videoAssetId: string;
  /** the upload the source came from; absent only for an asset that has no session left */
  uploadSessionId?: string;
  /** the finished run directory, which no other execution writes to */
  outputDir: string;
  /** from the transcode's completion marker; absent on jobs queued before it existed */
  durationMs?: number;
  resolution?: string;
  /** queued by a retry, so this stage starts the run (and sends processing.started) */
  startsRun?: boolean;
  /** The processing attempt this job belongs to, see stageJobId. */
  runId?: string;
  /** Thumbnails the transcode extracted; they go up packed with the data files. */
  thumbnailPaths?: string[];
}

export interface FinalizeJobData {
  videoAssetId: string;
  uploadSessionId?: string;
  /** The processing attempt this job belongs to, see stageJobId. */
  runId?: string;
  manifestObjectId: string;
  thumbnailObjectIds: string[];
  siaObjectIds?: string[];
  durationMs: number;
  resolution: string;
  segmentCount: number;
  totalStorageBytes: number;
  /** Normalized rendition + artifact mapping to persist for this asset. */
  storageRecords: StorageRecords;
}

export interface ReconcileJobData {
  /** Whether the schedule or a manual trigger started the run. */
  trigger: 'scheduled' | 'manual';
}

/**
 * Deletion queue jobs. `delete` unpins one asset's objects and removes its
 * row; `gc` sweeps for soft-deleted assets whose deletion never finished and
 * re-enqueues a `delete` for each.
 */
export type DeletionJobData =
  | {
      kind: 'delete';
      videoAssetId: string;
      /** how many times the gc sweep has queued this asset again */
      redrive?: number;
    }
  | { kind: 'gc' };

/** Transcodes an uploaded source into the HLS (fMP4) rendition ladder. */
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

/** Uploads a finished transcode run to Sia, see storage/segment-uploader.ts. */
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

/** Records a run's objects on the asset, marks it ready and sends asset.ready. */
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
 * scheduled job and by on-demand API triggers, both through
 * enqueueReconciliationRun so only one run is ever pending.
 */
export const reconcileQueue = new Queue<ReconcileJobData>('reconcile', {
  connection: redisConnection,
  defaultJobOptions: RECONCILE_JOB_OPTIONS,
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
 * Queue for webhook deliveries, one job per event and endpoint. Retries use
 * the worker's custom backoff (10 s, 1 min, 5 min), see webhooks/delivery.ts.
 */
export const webhookQueue = new Queue<WebhookJobData>(WEBHOOK_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: webhookJobOptions,
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
    webhookQueue.close(),
  ]);
}

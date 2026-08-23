import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { redisConnection, deletionQueue, type DeletionJobData } from '../queue/bull-config.js';
import { env } from '../config/env.js';
import { deleteObject, pruneSlabs } from '../storage/sia-client.js';
import {
  deleteVideoAsset,
  getAssetObjectIds,
  listAssetsPendingDeletion,
} from '../db/queries/assets.js';
import { runAssetDeletion } from './deleter.js';
import { buildDeletionGc } from './service.js';

const logger = pino({ name: 'deletion-worker' });

/** Enqueue a fresh deletion attempt. GC re-drives use a unique job id so a
 *  prior failed job (kept for inspection) does not block re-adding. */
async function enqueueDeletion(
  data: { videoAssetId: string; objectIds: string[] },
  opts: { jobId?: string } = {},
): Promise<void> {
  await deletionQueue.add('delete', { kind: 'delete', ...data }, opts);
}

const runGc = buildDeletionGc({
  listPending: () => listAssetsPendingDeletion(env.DELETION_STUCK_THRESHOLD_MS),
  collectObjectIds: (id) => getAssetObjectIds(id),
  enqueue: (data) => enqueueDeletion(data, { jobId: `redrive-${data.videoAssetId}-${Date.now()}` }),
  logger,
});

/**
 * BullMQ worker for the deletion queue. A `delete` job unpins one asset's
 * objects and removes its row; a `gc` job re-drives stuck deletions.
 */
export const deletionWorker = new Worker<DeletionJobData>(
  'deletion',
  async (job: Job<DeletionJobData>) => {
    if (job.data.kind === 'gc') {
      const redriven = await runGc();
      return { redriven };
    }

    const { videoAssetId, objectIds } = job.data;
    logger.info({ videoAssetId, objectCount: objectIds.length }, 'Starting asset deletion');
    return runAssetDeletion(
      {
        deleteObject,
        pruneSlabs,
        removeAsset: async (id) => {
          await deleteVideoAsset(id);
        },
        logger,
      },
      { videoAssetId, objectIds },
    );
  },
  { connection: redisConnection, concurrency: 2 },
);

deletionWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, kind: job?.data.kind, error: error.message },
    'Deletion job failed',
  );
});

/**
 * Register the repeatable GC sweep. Fixed jobId so restarts reuse the one
 * schedule rather than stacking duplicates.
 */
export async function scheduleDeletionGc(): Promise<void> {
  if (!env.DELETION_GC_ENABLED) {
    logger.info('Deletion GC disabled (DELETION_GC_ENABLED=false)');
    return;
  }
  await deletionQueue.add(
    'gc',
    { kind: 'gc' },
    { repeat: { every: env.DELETION_GC_INTERVAL_MS }, jobId: 'deletion-gc-scheduled' },
  );
  logger.info({ everyMs: env.DELETION_GC_INTERVAL_MS }, 'Deletion GC sweep scheduled');
}

export async function closeDeletionWorker(): Promise<void> {
  await deletionWorker.close();
}

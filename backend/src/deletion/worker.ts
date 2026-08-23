import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { redisConnection, deletionQueue, type DeletionJobData } from '../queue/bull-config.js';
import { env } from '../config/env.js';
import { deleteObject, pruneSlabs } from '../storage/sia-client.js';
import {
  deleteVideoAsset,
  getAssetObjectIds,
  markObjectsUnpinned,
  listAssetsPendingDeletion,
} from '../db/queries/assets.js';
import { evictObjects } from '../storage/blob-manager.js';
import { invalidateObjectAccessTier } from '../delivery/access-control.js';
import { runAssetDeletion } from './deleter.js';
import { buildDeletionGc } from './service.js';

const logger = pino({ name: 'deletion-worker' });

/** Enqueue a deletion attempt. GC re-drives use a unique job id so a prior
 *  failed job (kept for inspection) does not block re-adding. */
async function enqueueDeletion(videoAssetId: string, opts: { jobId?: string } = {}): Promise<void> {
  await deletionQueue.add('delete', { kind: 'delete', videoAssetId }, opts);
}

/** Drop unpinned objects from both the LRU blob cache and the tier cache. */
function evictCache(objectIds: string[]): void {
  evictObjects(objectIds);
  for (const id of objectIds) invalidateObjectAccessTier(id);
}

const runGc = buildDeletionGc({
  listPending: () => listAssetsPendingDeletion(env.DELETION_STUCK_THRESHOLD_MS),
  enqueue: (id) => enqueueDeletion(id, { jobId: `redrive-${id}-${Date.now()}` }),
  logger,
});

/**
 * BullMQ worker for the deletion queue. A `delete` job unpins one asset's
 * objects and removes its row; a `gc` job re-drives stuck deletions. Object
 * ids are collected fresh on every attempt, so a retry only re-attempts the
 * objects that still remain (markObjectsUnpinned removes the rest).
 */
export const deletionWorker = new Worker<DeletionJobData>(
  'deletion',
  async (job: Job<DeletionJobData>) => {
    if (job.data.kind === 'gc') {
      const redriven = await runGc();
      return { redriven };
    }

    const { videoAssetId } = job.data;
    const objectIds = await getAssetObjectIds(videoAssetId);
    logger.info({ videoAssetId, objectCount: objectIds.length }, 'Starting asset deletion');

    return runAssetDeletion(
      {
        deleteObject,
        pruneSlabs,
        markUnpinned: markObjectsUnpinned,
        evictCache,
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

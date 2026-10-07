import { Worker, type Job } from 'bullmq';
import { logger as rootLogger } from '../config/logger.js';
import { redisConnection, deletionQueue, type DeletionJobData } from '../queue/bull-config.js';
import { env } from '../config/env.js';
import { getAssetObjectIds, listAssetsPendingDeletion } from '../db/queries/assets.js';
import { runAssetDeletion } from './deleter.js';
import { buildDeletionGc } from './service.js';
import { assetDeletionDeps, releaseLeftoverObjects, sweepTranscodeOutput } from './wiring.js';
import { applySweepSchedule, DELETION_GC_SWEEP } from '../queue/schedules.js';

const logger = rootLogger.child({ name: 'deletion-worker' });

const IN_FLIGHT = new Set(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);

/** The job ids a delete of one asset runs under: the API's, and the gc sweep's. */
const deleteJobIds = (videoAssetId: string) => [
  `delete-${videoAssetId}`,
  `redrive-${videoAssetId}`,
];

const runGc = buildDeletionGc({
  listPending: () => listAssetsPendingDeletion(env.DELETION_STUCK_THRESHOLD_MS),
  deletionInFlight: async (videoAssetId) => {
    for (const jobId of deleteJobIds(videoAssetId)) {
      const job = await deletionQueue.getJob(jobId);
      if (job && IN_FLIGHT.has(await job.getState())) return true;
    }
    return false;
  },
  redrive: async (videoAssetId) => {
    // one re-drive job per asset, replaced each time, so the count carries over
    const jobId = `redrive-${videoAssetId}`;
    const previous = await deletionQueue.getJob(jobId);
    const redrive = (previous?.data.kind === 'delete' ? (previous.data.redrive ?? 0) : 0) + 1;
    await previous?.remove();
    await deletionQueue.add('delete', { kind: 'delete', videoAssetId, redrive }, { jobId });
    return redrive;
  },
  releaseObjects: releaseLeftoverObjects,
  sweepOutput: () => sweepTranscodeOutput(logger),
  logger,
});

/**
 * BullMQ worker for the deletion queue. A `delete` job unpins one asset's
 * objects and removes its row; a `gc` job re-drives stuck deletions and
 * cleans up after the pipeline. Object ids are collected fresh on every
 * attempt, so a retry only re-attempts the objects that still remain
 * (markObjectsUnpinned removes the rest).
 */
export const deletionWorker = new Worker<DeletionJobData>(
  'deletion',
  async (job: Job<DeletionJobData>) => {
    if (job.data.kind === 'gc') return runGc();

    const { videoAssetId } = job.data;
    const objectIds = await getAssetObjectIds(videoAssetId);
    logger.info({ videoAssetId, objectCount: objectIds.length }, 'Starting asset deletion');
    return runAssetDeletion(assetDeletionDeps(logger), { videoAssetId, objectIds });
  },
  { connection: redisConnection, concurrency: 2 },
);

deletionWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, kind: job?.data.kind, error: error.message },
    'Deletion job failed',
  );
});

/** Make the GC sweep's schedule match the settings, removing it when disabled. */
export async function scheduleDeletionGc(): Promise<void> {
  if (!env.DELETION_GC_ENABLED) {
    await applySweepSchedule(deletionQueue, DELETION_GC_SWEEP, null);
    logger.info('Deletion GC disabled (DELETION_GC_ENABLED=false)');
    return;
  }
  await applySweepSchedule(deletionQueue, DELETION_GC_SWEEP, env.DELETION_GC_INTERVAL_MS);
  logger.info({ everyMs: env.DELETION_GC_INTERVAL_MS }, 'Deletion GC sweep scheduled');
}

export async function closeDeletionWorker(): Promise<void> {
  await deletionWorker.close();
}

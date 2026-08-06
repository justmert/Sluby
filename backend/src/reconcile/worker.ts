import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { redisConnection, reconcileQueue, type ReconcileJobData } from '../queue/bull-config.js';
import { env } from '../config/env.js';
import { runReconciliation } from './reconciler.js';
import { collectObjectIds } from './collect-inventory.js';
import { listObjectEventsPage } from '../storage/sia-client.js';
import { getAllTrackedObjectIds, recordReconciliationRun } from '../db/queries/reconciliation.js';

const logger = pino({ name: 'reconcile-worker' });

/**
 * BullMQ worker that runs one reconciliation pass per job. The heavy
 * lifting (diffing, replaying the change feed) lives in unit-tested pure
 * modules; this file just wires the real DB + indexer into them.
 */
export const reconcileWorker = new Worker<ReconcileJobData>(
  'reconcile',
  async (job: Job<ReconcileJobData>) => {
    logger.info({ trigger: job.data.trigger }, 'Starting reconciliation run');

    const summary = await runReconciliation({
      getDbObjectIds: () => getAllTrackedObjectIds(),
      getIndexerObjectIds: () =>
        collectObjectIds((cursor, limit) => listObjectEventsPage(cursor, limit), {
          pageSize: env.RECONCILE_PAGE_SIZE,
        }),
      recordRun: (s) => recordReconciliationRun(s),
      now: () => new Date(),
    });

    logger.info(
      {
        status: summary.status,
        db: summary.dbObjectCount,
        indexer: summary.indexerObjectCount,
        orphans: summary.orphanCount,
        missing: summary.missingCount,
      },
      'Reconciliation run complete',
    );
    return summary;
  },
  { connection: redisConnection, concurrency: 1 },
);

reconcileWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, 'Reconciliation run failed');
});

/**
 * Register the repeatable scheduled sweep. Uses a fixed jobId so repeated
 * calls (e.g. across restarts) reuse the same schedule rather than stack up.
 */
export async function scheduleReconciliation(): Promise<void> {
  if (!env.RECONCILE_ENABLED) {
    logger.info('Reconciliation scheduling disabled (RECONCILE_ENABLED=false)');
    return;
  }
  await reconcileQueue.add(
    'reconcile',
    { trigger: 'scheduled' },
    {
      repeat: { every: env.RECONCILE_INTERVAL_MS },
      jobId: 'reconcile-scheduled',
    },
  );
  logger.info({ everyMs: env.RECONCILE_INTERVAL_MS }, 'Reconciliation sweep scheduled');
}

/** Enqueue a one-off reconciliation run (backs the API trigger). */
export async function triggerReconciliation(): Promise<void> {
  await reconcileQueue.add('reconcile', { trigger: 'manual' });
}

export async function closeReconcileWorker(): Promise<void> {
  await reconcileWorker.close();
}

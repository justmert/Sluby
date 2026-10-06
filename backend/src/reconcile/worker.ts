import { Worker } from 'bullmq';
import pino from 'pino';
import { redisConnection, reconcileQueue, type ReconcileJobData } from '../queue/bull-config.js';
import { env } from '../config/env.js';
import { runReconciliation } from './reconciler.js';
import {
  RECONCILE_WORKER_CONCURRENCY,
  createReconcileProcessor,
  enqueueReconciliationRun,
  type EnqueueRunResult,
} from './enqueue.js';
import { syncObjectFeed } from './collect-inventory.js';
import { getAccountInfo, listObjectEventsPage } from '../storage/sia-client.js';
import {
  getAllTrackedObjectIds,
  getIndexerInventory,
  indexerFeedStore,
  recordReconciliationRun,
} from '../db/queries/reconciliation.js';
import { applySweepSchedule, RECONCILE_SWEEP } from '../queue/schedules.js';

const logger = pino({ name: 'reconcile-worker' });

async function runPass(trigger: ReconcileJobData['trigger']) {
  logger.info({ trigger }, 'Starting reconciliation run');

  const summary = await runReconciliation({
    getDbObjectIds: () => getAllTrackedObjectIds(),
    syncIndexer: async (settledBefore) => {
      // the saved inventory belongs to one indexer account; another one
      // (a new app key or indexer) starts it over
      const { accountKey } = await getAccountInfo();
      await syncObjectFeed(
        (cursor, limit) => listObjectEventsPage(cursor, limit),
        indexerFeedStore,
        {
          feed: `${env.SIA_INDEXER_URL} ${accountKey}`,
          settledBefore,
          pageSize: env.RECONCILE_PAGE_SIZE,
        },
      );
    },
    getIndexerInventory: () => getIndexerInventory(),
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
      inFlight: summary.inFlightCount,
    },
    'Reconciliation run complete',
  );
  return summary;
}

/**
 * BullMQ worker for the reconcile queue. The heavy lifting (diffing,
 * reading the change feed) lives in unit-tested pure modules; this file
 * just wires the real DB + indexer into them.
 */
export const reconcileWorker = new Worker<ReconcileJobData>(
  'reconcile',
  createReconcileProcessor({ queue: reconcileQueue, run: runPass }),
  { connection: redisConnection, concurrency: RECONCILE_WORKER_CONCURRENCY },
);

reconcileWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, 'Reconciliation run failed');
});

/** Make the scheduled sweep match the settings, removing it when disabled. */
export async function scheduleReconciliation(): Promise<void> {
  if (!env.RECONCILE_ENABLED) {
    await applySweepSchedule(reconcileQueue, RECONCILE_SWEEP, null);
    logger.info('Reconciliation scheduling disabled (RECONCILE_ENABLED=false)');
    return;
  }
  await applySweepSchedule(reconcileQueue, RECONCILE_SWEEP, env.RECONCILE_INTERVAL_MS);
  logger.info({ everyMs: env.RECONCILE_INTERVAL_MS }, 'Reconciliation sweep scheduled');
}

/** Enqueue a one-off run (backs the API trigger) unless one is already pending. */
export function triggerReconciliation(): Promise<EnqueueRunResult> {
  return enqueueReconciliationRun(reconcileQueue, 'manual');
}

export async function closeReconcileWorker(): Promise<void> {
  await reconcileWorker.close();
}

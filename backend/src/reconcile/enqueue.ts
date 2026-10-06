import { randomUUID } from 'node:crypto';
import type { DefaultJobOptions, Job, Queue } from 'bullmq';
import type { ReconcileJobData } from '../queue/bull-config.js';

/**
 * Every run, manual or scheduled, is added under this deduplication id, so at
 * most one run is waiting or active at a time. A plain fixed jobId would not
 * do: the queue keeps finished jobs (removeOnComplete/removeOnFail) and BullMQ
 * ignores an add whose job id it still holds, so after the first run every
 * later trigger would be dropped. A deduplication key is deleted when its job
 * completes or fails, and each run still gets an id of its own.
 */
export const RECONCILE_RUN_DEDUPE_ID = 'reconcile-run';

/** Defaults for the reconcile queue; finished runs are kept for inspection. */
export const RECONCILE_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 1,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

/**
 * Two slots so a schedule tick is handled while a run is active and is
 * deduplicated against it, rather than waiting behind it and queuing another
 * run the moment it finishes. Runs still never overlap: the deduplicated add
 * keeps at most one pending.
 */
export const RECONCILE_WORKER_CONCURRENCY = 2;

export interface EnqueueRunResult {
  /** False when a run was already waiting or active and nothing was added. */
  enqueued: boolean;
  /** The new run's job id, or the one already pending. */
  jobId: string;
}

export async function enqueueReconciliationRun(
  queue: Queue<ReconcileJobData>,
  trigger: ReconcileJobData['trigger'],
): Promise<EnqueueRunResult> {
  // a deduplicated add returns the pending job's id instead of the one asked
  // for, which tells the two outcomes apart without a second, racy lookup
  const requestedId = `run-${randomUUID()}`;
  const job = await queue.add(
    'run',
    { trigger },
    { jobId: requestedId, deduplication: { id: RECONCILE_RUN_DEDUPE_ID } },
  );
  return { enqueued: job.id === requestedId, jobId: job.id! };
}

export interface ReconcileProcessorDeps {
  queue: Queue<ReconcileJobData>;
  /** One reconciliation pass. */
  run: (trigger: ReconcileJobData['trigger']) => Promise<unknown>;
}

/**
 * Jobs made by the schedule (RECONCILE_SWEEP, they carry a repeatJobKey) do not run
 * a pass themselves: they enqueue one through the same deduplicated add as the
 * API trigger, so a tick that lands while a manual run is pending is dropped
 * instead of running a second pass right after it. Any other job is a run.
 */
export function createReconcileProcessor(deps: ReconcileProcessorDeps) {
  return async (job: Job<ReconcileJobData>) => {
    if (job.repeatJobKey) {
      return enqueueReconciliationRun(deps.queue, 'scheduled');
    }
    return deps.run(job.data.trigger);
  };
}

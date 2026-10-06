import type { Queue } from 'bullmq';
import type { DeletionJobData, ReconcileJobData } from './bull-config.js';

/** One periodic sweep: the jobs a BullMQ job scheduler makes on its queue. */
export interface Sweep<T> {
  /** The job scheduler id, which upserts replace by. */
  id: string;
  /** Name and data of every job the schedule makes. */
  name: string;
  data: T;
}

/** The reconciliation tick, see createReconcileProcessor. */
export const RECONCILE_SWEEP: Sweep<ReconcileJobData> = {
  id: 'reconcile-scheduled',
  name: 'reconcile',
  data: { trigger: 'scheduled' },
};

/** The deletion GC tick, which re-drives stuck deletions. */
export const DELETION_GC_SWEEP: Sweep<DeletionJobData> = {
  id: 'deletion-gc-scheduled',
  name: 'gc',
  data: { kind: 'gc' },
};

/**
 * Make a sweep's schedule in Redis match the current settings, at every boot:
 * an upsert replaces it in place when the interval changed, and a sweep that
 * is turned off (`everyMs` null) is removed, since the schedule outlives the
 * process that registered it. Versions before job schedulers registered the
 * sweep with `queue.add(..., { repeat })`, whose key includes the interval, so
 * entries of the same job name under any other key are removed as well.
 */
export async function applySweepSchedule<T>(
  queue: Queue<T, unknown, string, T, unknown, string>,
  sweep: Sweep<T>,
  everyMs: number | null,
): Promise<void> {
  const removed = new Set<string>();
  for (const existing of await queue.getJobSchedulers()) {
    if (existing.key !== sweep.id && existing.name === sweep.name) removed.add(existing.key);
  }
  if (everyMs === null) removed.add(sweep.id);

  for (const key of removed) await queue.removeJobScheduler(key);
  if (removed.size > 0) {
    // removing a scheduler drops its next delayed job, but a run it already
    // made due (the first one, or one no worker took yet) would still run once
    const due = await queue.getJobs(['waiting', 'prioritized', 'paused', 'delayed']);
    for (const job of due) {
      if (job.repeatJobKey && removed.has(job.repeatJobKey)) await job.remove();
    }
  }

  if (everyMs !== null) {
    await queue.upsertJobScheduler(
      sweep.id,
      { every: everyMs },
      { name: sweep.name, data: sweep.data },
    );
  }
}

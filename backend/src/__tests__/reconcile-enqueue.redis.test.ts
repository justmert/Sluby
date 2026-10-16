import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Queue, Worker } from 'bullmq';
import {
  RECONCILE_JOB_OPTIONS,
  RECONCILE_WORKER_CONCURRENCY,
  addReconcileSchedule,
  createReconcileProcessor,
  enqueueReconciliationRun,
} from '../reconcile/enqueue.js';
import type { ReconcileJobData } from '../queue/bull-config.js';
import { hasTestRedis, testQueuePrefix, testRedisConnection } from './helpers/redis.js';

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function deferred() {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  return { done, release };
}

describe.skipIf(!hasTestRedis)('reconciliation run dedupe (redis)', () => {
  let queue: Queue<ReconcileJobData>;
  let worker: Worker<ReconcileJobData> | undefined;
  let prefix: string;

  beforeEach(() => {
    prefix = testQueuePrefix();
    queue = new Queue<ReconcileJobData>('reconcile', {
      connection: testRedisConnection(),
      prefix,
      defaultJobOptions: RECONCILE_JOB_OPTIONS,
    });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  function startWorker(run: (trigger: ReconcileJobData['trigger']) => Promise<unknown>) {
    worker = new Worker<ReconcileJobData>('reconcile', createReconcileProcessor({ queue, run }), {
      connection: testRedisConnection(),
      prefix,
      concurrency: RECONCILE_WORKER_CONCURRENCY,
    });
    return worker;
  }

  const stateOf = async (id: string) => (await queue.getJob(id))?.getState();
  const runJobs = async () =>
    (await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'])).filter(
      (j) => j.name === 'run',
    );

  it('queues one run for any number of triggers while it waits', async () => {
    const first = await enqueueReconciliationRun(queue, 'manual');
    const second = await enqueueReconciliationRun(queue, 'manual');
    const fromSchedule = await enqueueReconciliationRun(queue, 'scheduled');

    expect(first.enqueued).toBe(true);
    expect(second).toEqual({ enqueued: false, jobId: first.jobId });
    expect(fromSchedule).toEqual({ enqueued: false, jobId: first.jobId });
    expect((await queue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('answers pending while a run is active, and queues a new one after it completes', async () => {
    const gate = deferred();
    startWorker(() => gate.done);

    const first = await enqueueReconciliationRun(queue, 'manual');
    await waitFor(async () => (await stateOf(first.jobId)) === 'active', 'the run to start');
    expect(await enqueueReconciliationRun(queue, 'manual')).toEqual({
      enqueued: false,
      jobId: first.jobId,
    });

    gate.release();
    await waitFor(async () => (await stateOf(first.jobId)) === 'completed', 'the run to complete');

    // the completed job is kept, and must not swallow the next trigger
    const next = await enqueueReconciliationRun(queue, 'manual');
    expect(next.enqueued).toBe(true);
    expect(next.jobId).not.toBe(first.jobId);
    await waitFor(async () => (await stateOf(next.jobId)) === 'completed', 'the second run');
    expect((await queue.getJobCounts('completed')).completed).toBe(2);
  });

  it('queues a new run after a failed one', async () => {
    startWorker(async () => {
      throw new Error('indexer down');
    });

    const first = await enqueueReconciliationRun(queue, 'manual');
    await waitFor(async () => (await stateOf(first.jobId)) === 'failed', 'the run to fail');
    expect((await queue.getJobCounts('failed')).failed).toBe(1);

    const next = await enqueueReconciliationRun(queue, 'manual');
    expect(next.enqueued).toBe(true);
    expect(next.jobId).not.toBe(first.jobId);
    await waitFor(async () => (await stateOf(next.jobId)) === 'failed', 'the second run');
    expect((await queue.getJobCounts('failed')).failed).toBe(2);
  });

  it('does not let schedule ticks and a manual trigger stack runs', async () => {
    const gate = deferred();
    const triggers: string[] = [];
    let active = 0;
    let maxActive = 0;
    startWorker(async (trigger) => {
      triggers.push(trigger);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.done;
      active -= 1;
    });

    try {
      await addReconcileSchedule(queue, 100);
      await waitFor(async () => triggers.length === 1, 'the first scheduled run');

      // several more ticks fire while that run is still active
      const ticks = async () =>
        (await queue.getJobs(['completed'])).filter((j) => j.name === 'reconcile');
      await waitFor(async () => (await ticks()).length >= 4, 'more schedule ticks');
      const manual = await enqueueReconciliationRun(queue, 'manual');

      expect(manual.enqueued).toBe(false);
      expect(triggers).toEqual(['scheduled']);
      expect(await runJobs()).toHaveLength(1);
      // the first tick queued the run, every later one found it pending
      const returned = (await ticks())
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((j) => (j.returnvalue as { enqueued: boolean }).enqueued);
      expect(returned[0]).toBe(true);
      expect(returned.slice(1).every((e) => e === false)).toBe(true);
    } finally {
      gate.release();
    }

    // once the run finishes, the next tick queues a fresh one
    await waitFor(async () => triggers.length >= 2, 'a run after the first completes');
    expect(maxActive).toBe(1);
    expect(triggers.every((t) => t === 'scheduled')).toBe(true);
  });
});

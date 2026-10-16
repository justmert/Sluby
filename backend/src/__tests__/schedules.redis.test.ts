import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Queue } from 'bullmq';
import {
  applySweepSchedule,
  DELETION_GC_SWEEP,
  RECONCILE_SWEEP,
  type Sweep,
} from '../queue/schedules.js';
import { hasTestRedis, testQueuePrefix, testRedisConnection } from './helpers/redis.js';

const HOUR = 60 * 60 * 1000;

// each case is one sweep on its own queue, booted the way the app boots it
describe.skipIf(!hasTestRedis)('sweep schedules across boots (redis)', () => {
  let queue: Queue;
  let prefix: string;

  beforeEach(() => {
    prefix = testQueuePrefix();
    queue = new Queue('sweeps', { connection: testRedisConnection(), prefix });
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  const schedules = async () =>
    (await queue.getJobSchedulers()).map((s) => ({ key: s.key, every: Number(s.every) }));
  // what is due to run: the next job each schedule placed
  const pendingJobs = async () =>
    (await queue.getJobs(['delayed', 'waiting', 'prioritized'])).map((j) => j.name);

  // the registration every version before job schedulers ran at boot
  const bootOldVersion = (sweep: Sweep<unknown>, everyMs: number) =>
    queue.add(sweep.name, sweep.data, { repeat: { every: everyMs }, jobId: sweep.id });

  for (const sweep of [RECONCILE_SWEEP, DELETION_GC_SWEEP] as Sweep<unknown>[]) {
    describe(sweep.name, () => {
      it('replaces the schedule when the interval changes between boots', async () => {
        await applySweepSchedule(queue, sweep, HOUR);
        await applySweepSchedule(queue, sweep, HOUR / 2);
        expect(await schedules()).toEqual([{ key: sweep.id, every: HOUR / 2 }]);
        expect(await pendingJobs()).toEqual([sweep.name]);
      });

      it('keeps one schedule and its next run when a boot changes nothing', async () => {
        await applySweepSchedule(queue, sweep, HOUR);
        const next = (await queue.getJobScheduler(sweep.id))?.next;
        await applySweepSchedule(queue, sweep, HOUR);
        expect(await schedules()).toEqual([{ key: sweep.id, every: HOUR }]);
        expect((await queue.getJobScheduler(sweep.id))?.next).toBe(next);
        expect(await pendingJobs()).toEqual([sweep.name]);
      });

      it('removes the schedule when the sweep is turned off', async () => {
        await applySweepSchedule(queue, sweep, HOUR);
        await applySweepSchedule(queue, sweep, null);
        expect(await schedules()).toEqual([]);
        expect(await pendingJobs()).toEqual([]);
      });

      it('takes over the schedule an older version registered', async () => {
        await bootOldVersion(sweep, HOUR);
        await applySweepSchedule(queue, sweep, HOUR / 2);
        expect(await schedules()).toEqual([{ key: sweep.id, every: HOUR / 2 }]);
        expect(await pendingJobs()).toEqual([sweep.name]);
      });

      it('removes an older version’s schedule when the sweep is turned off', async () => {
        await bootOldVersion(sweep, HOUR);
        await bootOldVersion(sweep, HOUR / 2);
        await applySweepSchedule(queue, sweep, null);
        expect(await schedules()).toEqual([]);
        expect(await pendingJobs()).toEqual([]);
      });

      it('makes jobs carrying the sweep’s data and its scheduler id', async () => {
        await applySweepSchedule(queue, sweep, HOUR);
        const [job] = await queue.getJobs(['delayed', 'waiting', 'prioritized']);
        expect(job.data).toEqual(sweep.data);
        expect(job.repeatJobKey).toBe(sweep.id);
      });
    });
  }

  it('leaves other jobs and other schedules on the queue alone', async () => {
    await queue.add('delete', { kind: 'delete', videoAssetId: 'a' });
    await queue.upsertJobScheduler('something-else', { every: HOUR }, { name: 'other' });
    await applySweepSchedule(queue, DELETION_GC_SWEEP, null);
    expect((await schedules()).map((s) => s.key)).toEqual(['something-else']);
    expect((await pendingJobs()).sort()).toEqual(['delete', 'other']);
  });
});

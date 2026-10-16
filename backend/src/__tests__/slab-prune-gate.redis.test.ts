import { describe, it, expect, afterEach } from 'vitest';
import { Queue } from 'bullmq';
import { RedisPruneLeases } from '../storage/prune-leases.js';
import { SlabPruneGate, UploadLeaseLost } from '../storage/slab-prune-gate.js';
import { hasTestRedis, testQueuePrefix, testRedisConnection } from './helpers/redis.js';

const RENEW_MS = 100;
// fifteen renewals, so a busy test machine does not lapse a live lease
const TTL_MS = 1500;
const POLL_MS = 20;

const quiet = { warn: () => {}, error: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}

/** A promise with its resolver, to hold a prune open. */
function held() {
  let release: () => void = () => {};
  const done = new Promise<void>((r) => (release = r));
  return { done, release };
}

/**
 * Each "process" is a gate with its own Redis connection, sharing only the
 * key prefix, which is what two backend replicas share.
 */
describe.skipIf(!hasTestRedis)('SlabPruneGate across processes (redis)', () => {
  const queues: Queue[] = [];
  const gates: SlabPruneGate[] = [];
  let prefix = '';

  afterEach(async () => {
    for (const gate of gates) gate.close();
    const client = queues.length > 0 ? await queues[0].client : undefined;
    for (const key of ['uploads', 'lock', 'wanted', 'epoch']) await client?.del(`${prefix}:${key}`);
    await Promise.all(queues.map((q) => q.close()));
    queues.length = gates.length = 0;
  });

  function processWith(prune: () => Promise<void>) {
    if (gates.length === 0) prefix = `${testQueuePrefix()}:slab-prune`;
    const queue = new Queue('slab-prune-gate', { connection: testRedisConnection() });
    queues.push(queue);
    const leases = new RedisPruneLeases(() => queue.client, {
      prefix,
      uploadTtlMs: TTL_MS,
      pruneTtlMs: TTL_MS,
    });
    const gate = new SlabPruneGate({
      prune,
      leases,
      log: quiet,
      renewMs: RENEW_MS,
      pollMs: POLL_MS,
    });
    gates.push(gate);
    return { gate, leases };
  }

  it("defers a prune asked for during another process's upload until that upload ends", async () => {
    const events: string[] = [];
    const a = processWith(async () => void events.push('prune by a'));
    const b = processWith(async () => void events.push('prune by b'));

    const lease = await a.gate.beginUpload();
    await expect(b.gate.request()).resolves.toBe('deferred');
    await sleep(5 * RENEW_MS);
    expect(events).toEqual([]);

    events.push('upload ended');
    a.gate.endUpload(lease);
    await until(() => events.length === 2);
    // either process may run it, but only once
    expect(events).toEqual(['upload ended', expect.stringMatching(/^prune by [ab]$/)]);
    await sleep(5 * RENEW_MS);
    expect(events).toHaveLength(2);
  });

  it('holds an upload while another process prunes', async () => {
    const events: string[] = [];
    const pruning = held();
    const a = processWith(async () => {
      events.push('prune started');
      await pruning.done;
      events.push('prune ended');
    });
    const b = processWith(async () => {});

    const prune = a.gate.request();
    await until(() => events.length === 1);
    const upload = b.gate.beginUpload().then((lease) => {
      events.push('upload started');
      return lease;
    });
    await sleep(10 * POLL_MS);
    expect(events).toEqual(['prune started']);

    pruning.release();
    await expect(prune).resolves.toBe('pruned');
    b.gate.endUpload(await upload);
    expect(events).toEqual(['prune started', 'prune ended', 'upload started']);
  });

  it('keeps a long upload blocking prunes past the lease ttl through its heartbeat', async () => {
    let prunes = 0;
    const a = processWith(async () => void prunes++);
    const b = processWith(async () => void prunes++);

    const lease = await a.gate.beginUpload();
    await sleep(2 * TTL_MS);
    await expect(b.gate.request()).resolves.toBe('deferred');
    expect(prunes).toBe(0);
    await expect(a.gate.confirmUpload(lease)).resolves.toBeUndefined();
    a.gate.endUpload(lease);
    await until(() => prunes === 1);
  });

  it('runs a deferred prune once the lease of a process that died expires', async () => {
    let prunes = 0;
    const a = processWith(async () => {});
    const b = processWith(async () => void prunes++);

    await a.gate.beginUpload();
    // the process dies: no more renewals, and no endUpload
    a.gate.close();
    const askedAt = Date.now();
    await expect(b.gate.request()).resolves.toBe('deferred');
    await until(() => prunes === 1, 4 * TTL_MS);
    expect(Date.now() - askedAt).toBeGreaterThanOrEqual(TTL_MS - 2 * RENEW_MS);
  });

  it('lets uploads go ahead once the lock of a process that died while pruning expires', async () => {
    const a = processWith(async () => {});
    const b = processWith(async () => {});

    // a takes the lock and dies before releasing it
    await expect(a.leases.claimPrune('dead-prune')).resolves.toBe('locked');
    const askedAt = Date.now();
    const lease = await b.gate.beginUpload();
    expect(Date.now() - askedAt).toBeGreaterThanOrEqual(TTL_MS - 2 * RENEW_MS);
    b.gate.endUpload(lease);
  });

  it('fails an upload before its pin when its lease lapsed and a prune ran', async () => {
    let prunes = 0;
    const a = processWith(async () => {});
    const b = processWith(async () => void prunes++);

    const lease = await a.gate.beginUpload();
    // the process stalls: its renewals stop for longer than the ttl
    a.gate.close();
    await sleep(TTL_MS + 2 * RENEW_MS);
    await expect(b.gate.request()).resolves.toBe('pruned');
    expect(prunes).toBe(1);
    await expect(a.gate.confirmUpload(lease)).rejects.toBeInstanceOf(UploadLeaseLost);
    a.gate.endUpload(lease);
  });

  it('takes a lapsed lease back when no prune ran meanwhile', async () => {
    const a = processWith(async () => {});
    const b = processWith(async () => {});

    const lease = await a.gate.beginUpload();
    a.gate.close();
    await sleep(TTL_MS + 2 * RENEW_MS);
    await expect(a.gate.confirmUpload(lease)).resolves.toBeUndefined();
    // the lease is live again, so a prune now waits for it
    await expect(b.gate.request()).resolves.toBe('deferred');
    a.gate.endUpload(lease);
  });
});

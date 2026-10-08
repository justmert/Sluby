import type { RedisClient } from 'bullmq';

/** How an upload's lease stood when it was renewed. */
export type UploadLeaseState =
  /** live all along */
  | 'held'
  /** it had lapsed, but no prune ran since it was claimed, so it was put back */
  | 'reclaimed'
  /** it lapsed and a prune is running now */
  | 'prune-running'
  /** it lapsed and a prune ran since it was claimed */
  | 'pruned';

export type PruneClaim = 'locked' | 'deferred' | 'busy' | 'idle';

/**
 * What the slab prune gate shares between backend processes: one lease per
 * upload in flight, a lock held while a prune runs, a counter of prunes, and
 * a flag for a prune that is waiting for uploads to end. Leases and the lock
 * expire on their own, so a process that dies holding them blocks nothing for
 * longer than a ttl.
 */
export interface PruneLeases {
  /**
   * Record an upload in flight. Gives the prune count to pass to renewUpload,
   * or null while a prune holds the lock.
   */
  claimUpload(id: string): Promise<number | null>;
  renewUpload(id: string, epoch: number): Promise<UploadLeaseState>;
  releaseUpload(id: string): Promise<void>;
  /**
   * Take the prune lock if no upload lease is live anywhere. 'deferred' marks
   * the prune as wanted; 'busy' means another prune holds the lock. With
   * onlyIfWanted, 'idle' means no prune is wanted any more.
   */
  claimPrune(token: string, onlyIfWanted?: boolean): Promise<PruneClaim>;
  renewPrune(token: string): Promise<boolean>;
  releasePrune(token: string): Promise<void>;
}

// expiries are scored with the server's clock, so replicas whose clocks
// disagree still agree on which leases are live
const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

const EPOCH = `
local epoch = tonumber(redis.call('GET', KEYS[3]) or '0')`;

// KEYS: uploads, lock, epoch. ARGV: id, ttl ms
const CLAIM_UPLOAD = `${NOW}${EPOCH}
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return epoch`;

// KEYS: uploads, lock, epoch. ARGV: id, ttl ms, epoch at claim.
// a lease still in the set blocked every prune since its claim, so extending
// it is safe; one that lapsed comes back only if no prune ran in between
const RENEW_UPLOAD = `${NOW}${EPOCH}
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
if epoch ~= tonumber(ARGV[3]) then return -2 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 0`;

const RELEASE_UPLOAD = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

// KEYS: uploads, lock, wanted, epoch. ARGV: token, ttl ms, only if wanted
const CLAIM_PRUNE = `${NOW}
if redis.call('EXISTS', KEYS[2]) == 1 then return 'busy' end
if ARGV[3] == '1' and redis.call('EXISTS', KEYS[3]) == 0 then return 'idle' end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) > 0 then
  redis.call('SET', KEYS[3], '1')
  return 'deferred'
end
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
redis.call('INCR', KEYS[4])
redis.call('DEL', KEYS[3])
return 'locked'`;

// KEYS: lock. ARGV: token, ttl ms
const RENEW_PRUNE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

const RELEASE_PRUNE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

const RENEWED: Record<number, UploadLeaseState> = {
  1: 'held',
  0: 'reclaimed',
  [-1]: 'prune-running',
  [-2]: 'pruned',
};

/** PruneLeases in the Redis the queues use, shared by every replica. */
export class RedisPruneLeases implements PruneLeases {
  private readonly keys: { uploads: string; lock: string; wanted: string; epoch: string };
  private ready: Promise<RedisClient> | null = null;

  constructor(
    private readonly client: () => Promise<RedisClient>,
    private readonly opts: { prefix: string; uploadTtlMs: number; pruneTtlMs: number },
  ) {
    this.keys = {
      uploads: `${opts.prefix}:uploads`,
      lock: `${opts.prefix}:lock`,
      wanted: `${opts.prefix}:wanted`,
      epoch: `${opts.prefix}:epoch`,
    };
  }

  private redis(): Promise<RedisClient> {
    if (!this.ready) {
      const ready = this.client().then((redis) => {
        // defining a command again on the same client replaces it with the same script
        redis.defineCommand('slubyClaimUploadLease', { numberOfKeys: 3, lua: CLAIM_UPLOAD });
        redis.defineCommand('slubyRenewUploadLease', { numberOfKeys: 3, lua: RENEW_UPLOAD });
        redis.defineCommand('slubyReleaseUploadLease', { numberOfKeys: 1, lua: RELEASE_UPLOAD });
        redis.defineCommand('slubyClaimPruneLock', { numberOfKeys: 4, lua: CLAIM_PRUNE });
        redis.defineCommand('slubyRenewPruneLock', { numberOfKeys: 1, lua: RENEW_PRUNE });
        redis.defineCommand('slubyReleasePruneLock', { numberOfKeys: 1, lua: RELEASE_PRUNE });
        return redis;
      });
      // a failed connection is tried again on the next call
      ready.catch(() => {
        if (this.ready === ready) this.ready = null;
      });
      this.ready = ready;
    }
    return this.ready;
  }

  private async run(command: string, args: string[]): Promise<unknown> {
    return (await this.redis()).runCommand(command, args);
  }

  async claimUpload(id: string): Promise<number | null> {
    const { uploads, lock, epoch } = this.keys;
    const ttl = String(this.opts.uploadTtlMs);
    const result = Number(await this.run('slubyClaimUploadLease', [uploads, lock, epoch, id, ttl]));
    return result < 0 ? null : result;
  }

  async renewUpload(id: string, epoch: number): Promise<UploadLeaseState> {
    const { uploads, lock, epoch: epochKey } = this.keys;
    const ttl = String(this.opts.uploadTtlMs);
    const result = Number(
      await this.run('slubyRenewUploadLease', [uploads, lock, epochKey, id, ttl, String(epoch)]),
    );
    return RENEWED[result];
  }

  async releaseUpload(id: string): Promise<void> {
    await this.run('slubyReleaseUploadLease', [this.keys.uploads, id]);
  }

  async claimPrune(token: string, onlyIfWanted = false): Promise<PruneClaim> {
    const { uploads, lock, wanted, epoch } = this.keys;
    const args = [uploads, lock, wanted, epoch, token, String(this.opts.pruneTtlMs)];
    return (await this.run('slubyClaimPruneLock', [
      ...args,
      onlyIfWanted ? '1' : '0',
    ])) as PruneClaim;
  }

  async renewPrune(token: string): Promise<boolean> {
    const ttl = String(this.opts.pruneTtlMs);
    return Number(await this.run('slubyRenewPruneLock', [this.keys.lock, token, ttl])) === 1;
  }

  async releasePrune(token: string): Promise<void> {
    await this.run('slubyReleasePruneLock', [this.keys.lock, token]);
  }
}

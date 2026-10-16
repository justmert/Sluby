import type { PruneClaim, PruneLeases, UploadLeaseState } from '../../storage/prune-leases.js';

/**
 * The prune leases of a single process, kept in memory, for the unit tests
 * that upload through sia-client without a Redis. It follows the Redis scripts
 * in prune-leases.ts; slab-prune-gate.redis.test.ts covers the real ones.
 */
export class MemoryPruneLeases implements PruneLeases {
  private readonly uploads = new Map<string, number>();
  private lock: { token: string; until: number } | null = null;
  private wanted = false;
  private epoch = 0;

  /** tests shorten it to let a lease lapse */
  ttlMs = 60_000;

  private locked(): boolean {
    if (this.lock && this.lock.until <= Date.now()) this.lock = null;
    return this.lock !== null;
  }

  async claimUpload(id: string): Promise<number | null> {
    if (this.locked()) return null;
    this.uploads.set(id, Date.now() + this.ttlMs);
    return this.epoch;
  }

  async renewUpload(id: string, epoch: number): Promise<UploadLeaseState> {
    if (this.uploads.has(id)) {
      this.uploads.set(id, Date.now() + this.ttlMs);
      return 'held';
    }
    if (this.locked()) return 'prune-running';
    if (epoch !== this.epoch) return 'pruned';
    this.uploads.set(id, Date.now() + this.ttlMs);
    return 'reclaimed';
  }

  async releaseUpload(id: string): Promise<void> {
    this.uploads.delete(id);
  }

  async claimPrune(token: string, onlyIfWanted = false): Promise<PruneClaim> {
    if (this.locked()) return 'busy';
    if (onlyIfWanted && !this.wanted) return 'idle';
    for (const [id, until] of this.uploads) if (until <= Date.now()) this.uploads.delete(id);
    if (this.uploads.size > 0) {
      this.wanted = true;
      return 'deferred';
    }
    this.lock = { token, until: Date.now() + this.ttlMs };
    this.epoch += 1;
    this.wanted = false;
    return 'locked';
  }

  async renewPrune(token: string): Promise<boolean> {
    if (this.lock?.token !== token) return false;
    this.lock.until = Date.now() + this.ttlMs;
    return true;
  }

  async releasePrune(token: string): Promise<void> {
    if (this.lock?.token === token) this.lock = null;
  }
}

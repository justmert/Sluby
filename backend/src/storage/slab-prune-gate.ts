import { randomUUID } from 'node:crypto';
import type { PruneClaim, PruneLeases } from './prune-leases.js';

interface GateLog {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface SlabPruneGateOptions {
  prune: () => Promise<void>;
  leases: PruneLeases;
  log: GateLog;
  /** How often uploads renew their leases and a running prune its lock. */
  renewMs: number;
  /** How often a process waiting on another replica asks again. */
  pollMs: number;
}

/** Thrown before the pin when a prune may have run during the upload. */
export class UploadLeaseLost extends Error {
  constructor(state: string) {
    super(
      `A slab prune may have run during this upload (its prune lease ${state}), so its ` +
        'slabs are not trusted and nothing is pinned',
    );
    this.name = 'UploadLeaseLost';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keeps slab pruning and uploads apart, across every backend process that
 * shares the Sia account. indexd prunes every slab of the account that no
 * pinned object references (persist/postgres/slabs.go PruneSlabs), with no
 * age grace, and the SDK pins each slab of an upload as soon as it is stored
 * but the objects only at the end, so a prune during an upload strips that
 * upload's slabs: indexd drops their sector records, and the SDK's pin then
 * has to re-pin slabs whose sectors the hosts may already have dropped.
 *
 * Each upload holds a lease in Redis that it renews while it runs, and a
 * prune takes a lock only when no lease is live anywhere; otherwise it is
 * marked wanted and runs when the last upload ends. Uploads wait while the
 * lock is held. Leases and the lock expire, so a replica that dies holding
 * them blocks the others for one ttl at most. Within one process the waits
 * go through promises, so only waits on another replica poll.
 */
export class SlabPruneGate {
  private running: Promise<unknown> | null = null;
  private readonly uploads = new Map<string, { epoch: number; lapsed?: string }>();
  private renewal: ReturnType<typeof setInterval> | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private watching = false;

  constructor(private readonly opts: SlabPruneGateOptions) {}

  /** Waits for a running prune, then holds a lease until endUpload. */
  async beginUpload(): Promise<string> {
    const id = randomUUID();
    for (;;) {
      while (this.running) await this.running.catch(() => {});
      const epoch = await this.opts.leases.claimUpload(id);
      if (epoch !== null) {
        this.uploads.set(id, { epoch });
        break;
      }
      // another replica is pruning
      await sleep(this.opts.pollMs);
    }
    if (!this.renewal) {
      this.renewal = setInterval(() => void this.renewUploads(), this.opts.renewMs);
      this.renewal.unref();
    }
    return id;
  }

  /**
   * Checks right before the pin that no prune ran during the upload. A lease
   * lapses only when the process stalls for longer than its ttl, and then a
   * prune elsewhere may have stripped the slabs it stored.
   */
  async confirmUpload(id: string): Promise<void> {
    const upload = this.uploads.get(id);
    if (!upload) throw new Error('confirmUpload called for an upload that is not in flight');
    if (upload.lapsed) throw new UploadLeaseLost(upload.lapsed);
    const state = await this.opts.leases.renewUpload(id, upload.epoch);
    if (state === 'prune-running' || state === 'pruned') {
      throw new UploadLeaseLost(
        state === 'pruned' ? 'lapsed and a prune ran' : 'lapsed during a prune',
      );
    }
  }

  endUpload(id: string): void {
    this.uploads.delete(id);
    if (this.uploads.size === 0 && this.renewal) {
      clearInterval(this.renewal);
      this.renewal = null;
    }
    this.afterUpload(id).catch((err: unknown) => {
      this.opts.log.warn({ err }, 'Deferred slab prune failed');
    });
  }

  /**
   * Prunes now when no upload is in flight anywhere, otherwise marks the
   * prune wanted and returns 'deferred': the last upload to end runs it, or
   * this process once the leases of a replica that died have expired.
   */
  async request(): Promise<'pruned' | 'deferred'> {
    return (await this.run(false)) as 'pruned' | 'deferred';
  }

  private async run(onlyIfWanted: boolean): Promise<'pruned' | 'deferred' | 'idle'> {
    for (;;) {
      // a prune already running may have read the slab list before the caller
      // unpinned anything, so wait for it and prune again
      while (this.running) await this.running.catch(() => {});
      const attempt: Promise<'pruned' | Exclude<PruneClaim, 'locked'>> = this.attempt(
        onlyIfWanted,
      ).finally(() => {
        if (this.running === attempt) this.running = null;
      });
      this.running = attempt;
      const outcome = await attempt;
      if (outcome === 'deferred') this.watchWanted();
      if (outcome !== 'busy') return outcome;
      // another replica is pruning
      await sleep(this.opts.pollMs);
    }
  }

  /** Stops the timers, for tests and shutdown; leases left behind expire. */
  close(): void {
    if (this.renewal) clearInterval(this.renewal);
    if (this.watch) clearInterval(this.watch);
    this.renewal = this.watch = null;
  }

  private async attempt(onlyIfWanted: boolean): Promise<'pruned' | Exclude<PruneClaim, 'locked'>> {
    const { leases, log } = this.opts;
    const token = randomUUID();
    const claim = await leases.claimPrune(token, onlyIfWanted);
    if (claim !== 'locked') return claim;
    const renewal = setInterval(() => {
      leases.renewPrune(token).then(
        (held) => {
          if (!held) {
            log.error(
              {},
              'The slab prune lock expired while the prune ran; uploads may start under it',
            );
          }
        },
        (err: unknown) => log.warn({ err }, 'Could not renew the slab prune lock'),
      );
    }, this.opts.renewMs);
    renewal.unref();
    try {
      await this.opts.prune();
    } finally {
      clearInterval(renewal);
      await leases.releasePrune(token).catch((err: unknown) => {
        // it expires by itself after one ttl
        log.warn({ err }, 'Could not release the slab prune lock');
      });
    }
    return 'pruned';
  }

  private async afterUpload(id: string): Promise<void> {
    await this.opts.leases.releaseUpload(id);
    // this process's other uploads still hold leases; the last one checks
    if (this.uploads.size > 0) return;
    await this.run(true);
  }

  private async renewUploads(): Promise<void> {
    for (const [id, upload] of this.uploads) {
      if (upload.lapsed) continue;
      try {
        const state = await this.opts.leases.renewUpload(id, upload.epoch);
        if (state === 'reclaimed') {
          this.opts.log.warn(
            { leaseId: id },
            'An upload prune lease lapsed while the process stalled; no prune ran meanwhile, so it was taken back',
          );
        } else if (state !== 'held') {
          upload.lapsed = state === 'pruned' ? 'lapsed and a prune ran' : 'lapsed during a prune';
          this.opts.log.error(
            { leaseId: id },
            'An upload prune lease lapsed and a prune ran; the upload will fail before its pin',
          );
        }
      } catch (err) {
        this.opts.log.warn({ err, leaseId: id }, 'Could not renew an upload prune lease');
      }
    }
  }

  /** Runs a wanted prune once nothing blocks it, including leases that expire. */
  private watchWanted(): void {
    if (this.watch) return;
    this.watch = setInterval(() => {
      if (this.watching || this.running) return;
      this.watching = true;
      this.checkWanted()
        .catch((err: unknown) => this.opts.log.warn({ err }, 'Deferred slab prune failed'))
        .finally(() => {
          this.watching = false;
        });
    }, this.opts.renewMs);
    this.watch.unref();
  }

  private async checkWanted(): Promise<void> {
    const stop = () => {
      if (this.watch) clearInterval(this.watch);
      this.watch = null;
    };
    if ((await this.run(true)) !== 'deferred') stop();
  }
}

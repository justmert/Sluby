/**
 * Counts failed sign-in and setup attempts per key (an IP or an email) in
 * fixed windows. Like rate-limiter.ts it lives in this process's memory: the
 * backend runs as one process, and a restart clears every window.
 */

interface Window {
  failures: number;
  resetAt: number;
}

export type AttemptCheck = { ok: true } | { ok: false; retryAfterSec: number };

export class AttemptLimiter {
  private readonly entries = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(opts: { limit: number; windowMs: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(key);
      }
    }, 60_000);
    // the sweep must not keep a test run or a shutting-down process alive
    sweep.unref();
  }

  /** Keys currently holding a window, swept or not. */
  get size(): number {
    return this.entries.size;
  }

  check(key: string): AttemptCheck {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now || entry.failures < this.limit) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  fail(key: string): void {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { failures: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.failures++;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

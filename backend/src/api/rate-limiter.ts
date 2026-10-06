import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../config/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters in this process's memory. The backend runs as one
 * process, so one map is the whole picture; a restart resets every window.
 */
class WindowCounter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(private readonly windowMs: number) {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(key);
      }
    }, 60_000);
    // the sweep must not keep a test run or a shutting-down process alive
    sweep.unref();
  }

  /** Count one request against `key` and return the window it landed in. */
  hit(key: string): RateLimitEntry {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count++;
    return entry;
  }

  /** Take back a hit, unless its window has already rolled over. */
  undo(key: string, window: RateLimitEntry): void {
    if (this.entries.get(key) === window && window.count > 0) window.count--;
  }
}

/** Set the X-RateLimit-* headers, and answer 429 when the window is full. */
function enforce(
  res: Response,
  entry: RateLimitEntry,
  limit: number,
  logKey: Record<string, unknown>,
): boolean {
  const remaining = Math.max(0, limit - entry.count);
  const reset = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));

  res.set({
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': reset.toString(),
  });

  if (entry.count <= limit) return true;

  logger.warn({ ...logKey, count: entry.count, limit }, 'Rate limit exceeded');
  // the standard header clients (and the SDK's RateLimitError.retryAfter)
  // read; the body says it too. retryAfter is the old spelling, kept one
  // more release.
  res.set('Retry-After', String(reset));
  res.status(429).json({ error: 'Rate limit exceeded', retry_after: reset, retryAfter: reset });
  return false;
}

/**
 * Per-key limiter for authenticated API calls. It runs after the API-key
 * middleware and buckets on the caller's key (or Studio session), with the
 * key's own rate_limit capped at the operator's maximum, so a key minted with
 * a huge limit cannot opt out.
 */
export function rateLimiter(maxLimit: number, windowMs = 60_000): RequestHandler {
  const counter = new WindowCounter(windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      next();
      return;
    }
    const limit = Math.min(req.apiKey.rateLimit, maxLimit);
    const entry = counter.hit(`key:${req.apiKey.id}`);
    if (enforce(res, entry, limit, { apiKeyId: req.apiKey.id })) next();
  };
}

export interface IpRateLimiter {
  /** Counts every request by client IP; mount it in front of authentication. */
  count: RequestHandler;
  /**
   * Takes the request's hit back once it has authenticated, so only
   * unauthenticated traffic (sign-in routes, bad or missing keys, the public
   * spec) is held to the per-IP limit and keyed callers are left to the
   * per-key limiter.
   */
  release: (req: Request) => void;
}

const ipHit = Symbol('ipRateLimitHit');
type CountedRequest = Request & { [ipHit]?: { key: string; entry: RateLimitEntry } };

/**
 * Per-client-IP limiter for requests that carry no valid credential. req.ip
 * is only the real client behind the shipped proxies when `trust proxy`
 * matches them (TRUST_PROXY).
 *
 * The hit is taken up front and handed back after authentication rather than
 * counted afterwards, so a burst of unauthenticated requests is cut off at
 * the limit instead of all passing before any of them is counted.
 */
export function createIpRateLimiter(limit: number, windowMs = 60_000): IpRateLimiter {
  const counter = new WindowCounter(windowMs);
  return {
    count: (req: Request, res: Response, next: NextFunction) => {
      const key = `ip:${req.ip ?? 'unknown'}`;
      const entry = counter.hit(key);
      (req as CountedRequest)[ipHit] = { key, entry };
      if (enforce(res, entry, limit, { ip: req.ip })) next();
    },
    release: (req: Request) => {
      const hit = (req as CountedRequest)[ipHit];
      if (!hit) return;
      delete (req as CountedRequest)[ipHit];
      counter.undo(hit.key, hit.entry);
    },
  };
}

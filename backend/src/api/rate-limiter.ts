import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * Rate limiting middleware.
 * Uses the API key's configured rate limit, or falls back to IP-based limiting.
 */
export function rateLimiter(defaultLimit = 100, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.apiKey?.id ?? req.ip ?? 'unknown';
    const limit = req.apiKey?.rateLimit ?? defaultLimit;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, limit - entry.count);
    const reset = Math.ceil((entry.resetAt - now) / 1000);

    res.set({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': reset.toString(),
    });

    if (entry.count > limit) {
      logger.warn({ key, count: entry.count, limit }, 'Rate limit exceeded');
      // The standard header clients (and the SDK's RateLimitError.retryAfter)
      // read; keep the body field too for convenience.
      res.set('Retry-After', String(reset));
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: reset,
      });
      return;
    }

    next();
  };
}

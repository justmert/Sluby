import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { rateLimiter } from '../api/rate-limiter.js';
import type { Request, Response } from 'express';

// Use unique IPs per test to avoid store collisions across tests
let testId = 0;
function nextTestIp(): string {
  testId++;
  return `100.${Math.floor(testId / 256)}.${testId % 256}.1`;
}

function createMockReq(ip: string, apiKey?: Request['apiKey']): Request {
  return {
    ip,
    apiKey,
  } as unknown as Request;
}

function createMockRes(): Response & { _status: number; _json: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(res._headers, headers);
      return res;
    },
  };
  return res as any;
}

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests under the limit', () => {
    const ip = nextTestIp();
    const middleware = rateLimiter(5, 60_000);
    const req = createMockReq(ip);
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res._headers['X-RateLimit-Limit']).toBe('5');
    expect(res._headers['X-RateLimit-Remaining']).toBe('4');
  });

  it('should block requests over the limit with 429', () => {
    const ip = nextTestIp();
    const middleware = rateLimiter(3, 60_000);
    const next = vi.fn();

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      middleware(req, res as any, next);
    }

    expect(next).toHaveBeenCalledTimes(3);

    // Next request should be blocked
    const req = createMockReq(ip);
    const res = createMockRes();
    const blockedNext = vi.fn();
    middleware(req, res as any, blockedNext);

    expect(blockedNext).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._json).toEqual(
      expect.objectContaining({ error: 'Rate limit exceeded' }),
    );
  });

  it('should set correct rate limit headers', () => {
    const ip = nextTestIp();
    const middleware = rateLimiter(10, 60_000);
    const req = createMockReq(ip);
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res._headers['X-RateLimit-Limit']).toBe('10');
    expect(res._headers['X-RateLimit-Remaining']).toBe('9');
    expect(res._headers['X-RateLimit-Reset']).toBeDefined();
    expect(parseInt(res._headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
  });

  it('should set remaining to 0 when at or over limit', () => {
    const ip = nextTestIp();
    const middleware = rateLimiter(1, 60_000);
    const next = vi.fn();

    // First request uses the one allowed
    const req1 = createMockReq(ip);
    const res1 = createMockRes();
    middleware(req1, res1 as any, next);
    expect(res1._headers['X-RateLimit-Remaining']).toBe('0');

    // Second request is over limit
    const req2 = createMockReq(ip);
    const res2 = createMockRes();
    middleware(req2, res2 as any, vi.fn());
    expect(res2._headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('should use apiKey.id as key when available', () => {
    const middleware = rateLimiter(2, 60_000);
    const next = vi.fn();

    // Make requests from two different API keys (apiKey.id is used as key, not IP)
    const req1 = createMockReq(nextTestIp(), {
      id: `key-${testId}-1`, name: 'test', scopes: [], rateLimit: 2, creatorAddress: '0x1',
    });
    const res1 = createMockRes();
    middleware(req1, res1 as any, next);

    const req2 = createMockReq(nextTestIp(), {
      id: `key-${testId}-2`, name: 'test', scopes: [], rateLimit: 2, creatorAddress: '0x2',
    });
    const res2 = createMockRes();
    middleware(req2, res2 as any, next);

    // Both should succeed because they use different keys
    expect(next).toHaveBeenCalledTimes(2);
    expect(res1._headers['X-RateLimit-Remaining']).toBe('1');
    expect(res2._headers['X-RateLimit-Remaining']).toBe('1');
  });

  it('should use apiKey.rateLimit when available', () => {
    const middleware = rateLimiter(100, 60_000); // default limit 100
    const next = vi.fn();

    const req = createMockReq(nextTestIp(), {
      id: `key-custom-${testId}`, name: 'test', scopes: [], rateLimit: 5, creatorAddress: '0x1',
    });
    const res = createMockRes();
    middleware(req, res as any, next);

    // Should use apiKey's rate limit of 5, not the default of 100
    expect(res._headers['X-RateLimit-Limit']).toBe('5');
    expect(res._headers['X-RateLimit-Remaining']).toBe('4');
  });

  it('should reset the count after the window expires', () => {
    const ip = nextTestIp();
    const windowMs = 60_000;
    const middleware = rateLimiter(2, windowMs);
    const next = vi.fn();

    // Use up the limit
    for (let i = 0; i < 2; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      middleware(req, res as any, next);
    }
    expect(next).toHaveBeenCalledTimes(2);

    // Third request should be blocked
    const blockedRes = createMockRes();
    middleware(createMockReq(ip), blockedRes as any, vi.fn());
    expect(blockedRes._status).toBe(429);

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1);

    // Now request should succeed again
    const freshRes = createMockRes();
    const freshNext = vi.fn();
    middleware(createMockReq(ip), freshRes as any, freshNext);

    expect(freshNext).toHaveBeenCalled();
    expect(freshRes._headers['X-RateLimit-Remaining']).toBe('1');
  });

  it('should fall back to IP-based limiting when no apiKey is present', () => {
    const ip1 = nextTestIp();
    const ip2 = nextTestIp();
    const middleware = rateLimiter(2, 60_000);
    const next = vi.fn();

    // Same IP, no apiKey
    for (let i = 0; i < 2; i++) {
      middleware(createMockReq(ip1), createMockRes() as any, next);
    }

    // Third from same IP should be blocked
    const blocked = createMockRes();
    middleware(createMockReq(ip1), blocked as any, vi.fn());
    expect(blocked._status).toBe(429);

    // Different IP should still be allowed
    const otherRes = createMockRes();
    const otherNext = vi.fn();
    middleware(createMockReq(ip2), otherRes as any, otherNext);
    expect(otherNext).toHaveBeenCalled();
  });

  it('should include retryAfter in the 429 response body', () => {
    const ip = nextTestIp();
    const middleware = rateLimiter(1, 60_000);
    const next = vi.fn();

    // Use up the limit
    middleware(createMockReq(ip), createMockRes() as any, next);

    // Next request should be blocked with retryAfter
    const res = createMockRes();
    middleware(createMockReq(ip), res as any, vi.fn());

    expect(res._status).toBe(429);
    expect((res._json as any).retryAfter).toBeDefined();
    expect(typeof (res._json as any).retryAfter).toBe('number');
    expect((res._json as any).retryAfter).toBeGreaterThan(0);
  });
});

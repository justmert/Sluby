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

import { rateLimiter, createIpRateLimiter } from '../api/rate-limiter.js';
import type { Request, Response } from 'express';

// the app-level behaviour (through createApp, with a real client address and
// real keys) is covered in app-edge.pg.test.ts; these pin the counting rules

let testId = 0;
function nextId(): string {
  testId++;
  return String(testId);
}

function apiKey(rateLimit: number, id = `key-${nextId()}`): NonNullable<Request['apiKey']> {
  return { id, name: 'test', scopes: [], rateLimit, creatorAddress: '0x1' };
}

function mockReq(over: Partial<Request> = {}): Request {
  return { ip: `100.0.0.${nextId()}`, ...over } as unknown as Request;
}

function mockRes(): Response & {
  _status: number;
  _json: unknown;
  _headers: Record<string, string>;
} {
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
    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === 'string') res._headers[field] = value!;
      else Object.assign(res._headers, field);
      return res;
    },
  };
  return res as unknown as Response & {
    _status: number;
    _json: unknown;
    _headers: Record<string, string>;
  };
}

describe('rateLimiter (per key)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honours the key's own limit and answers 429 with Retry-After past it", () => {
    const middleware = rateLimiter(100, 60_000);
    const key = apiKey(2);
    const next = vi.fn();
    middleware(mockReq({ apiKey: key }), mockRes(), next);
    const second = mockRes();
    middleware(mockReq({ apiKey: key }), second, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(second._headers['X-RateLimit-Limit']).toBe('2');
    expect(second._headers['X-RateLimit-Remaining']).toBe('0');

    const blocked = mockRes();
    const blockedNext = vi.fn();
    middleware(mockReq({ apiKey: key }), blocked, blockedNext);
    expect(blockedNext).not.toHaveBeenCalled();
    expect(blocked._status).toBe(429);
    expect(Number(blocked._headers['Retry-After'])).toBeGreaterThan(0);
    expect((blocked._json as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
  });

  it('caps a key that asked for more than the operator maximum', () => {
    const middleware = rateLimiter(3, 60_000);
    const key = apiKey(1_000_000_000);
    const res = mockRes();
    middleware(mockReq({ apiKey: key }), res, vi.fn());
    expect(res._headers['X-RateLimit-Limit']).toBe('3');
  });

  it('buckets per key, not per address', () => {
    const middleware = rateLimiter(100, 60_000);
    const next = vi.fn();
    const ip = '100.1.1.1';
    middleware(mockReq({ ip, apiKey: apiKey(1) }), mockRes(), next);
    middleware(mockReq({ ip, apiKey: apiKey(1) }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh window after the old one ends', () => {
    const middleware = rateLimiter(100, 60_000);
    const key = apiKey(1);
    middleware(mockReq({ apiKey: key }), mockRes(), vi.fn());
    const blocked = mockRes();
    middleware(mockReq({ apiKey: key }), blocked, vi.fn());
    expect(blocked._status).toBe(429);
    vi.advanceTimersByTime(60_001);
    const next = vi.fn();
    middleware(mockReq({ apiKey: key }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('leaves a request without a key to the per-IP limiter', () => {
    const middleware = rateLimiter(1, 60_000);
    const next = vi.fn();
    const res = mockRes();
    middleware(mockReq(), res, next);
    middleware(mockReq(), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res._headers['X-RateLimit-Limit']).toBeUndefined();
  });
});

describe('createIpRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts one address off at the limit and leaves others alone', () => {
    const limiter = createIpRateLimiter(2, 60_000);
    const next = vi.fn();
    limiter.count(mockReq({ ip: '203.0.113.1' }), mockRes(), next);
    limiter.count(mockReq({ ip: '203.0.113.1' }), mockRes(), next);
    const blocked = mockRes();
    limiter.count(mockReq({ ip: '203.0.113.1' }), blocked, vi.fn());
    expect(blocked._status).toBe(429);
    expect(Number(blocked._headers['Retry-After'])).toBeGreaterThan(0);

    limiter.count(mockReq({ ip: '203.0.113.2' }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('gives a released hit back, so authenticated calls do not use up the budget', () => {
    const limiter = createIpRateLimiter(1, 60_000);
    const next = vi.fn();
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ ip: '203.0.113.3' });
      limiter.count(req, mockRes(), next);
      limiter.release(req);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('releases a hit only once', () => {
    const limiter = createIpRateLimiter(2, 60_000);
    const req = mockReq({ ip: '203.0.113.4' });
    limiter.count(req, mockRes(), vi.fn());
    limiter.count(mockReq({ ip: '203.0.113.4' }), mockRes(), vi.fn());
    limiter.release(req);
    limiter.release(req);
    const res = mockRes();
    limiter.count(mockReq({ ip: '203.0.113.4' }), res, vi.fn());
    expect(res._headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('does not take a released hit out of the next window', () => {
    const limiter = createIpRateLimiter(1, 60_000);
    const old = mockReq({ ip: '203.0.113.5' });
    limiter.count(old, mockRes(), vi.fn());
    vi.advanceTimersByTime(60_001);
    const fresh = mockRes();
    limiter.count(mockReq({ ip: '203.0.113.5' }), fresh, vi.fn());
    limiter.release(old);
    const blocked = mockRes();
    limiter.count(mockReq({ ip: '203.0.113.5' }), blocked, vi.fn());
    expect(blocked._status).toBe(429);
  });
});

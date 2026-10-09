import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, RateLimitError, TimeoutError } from '@sluby/sdk';
import { ApiError, RequestTimeoutError } from './api-client';
import { createQueryClient, retryDelay } from './query-client';
import { onUnauthorized } from './session-events';

afterEach(() => vi.useRealTimers());

async function attempts(error: unknown): Promise<number> {
  const client = createQueryClient();
  // no backoff wait, so the retry happens inside the test
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
  });
  const fn = vi.fn().mockRejectedValue(error);
  await client.fetchQuery({ queryKey: ['x'], queryFn: fn }).catch(() => {});
  return fn.mock.calls.length;
}

describe('the studio query client', () => {
  it('does not retry a 4xx, from apiClient or the sdk', async () => {
    expect(await attempts(new ApiError(404, 'gone'))).toBe(1);
    expect(await attempts(new ApiError(403, 'no'))).toBe(1);
    expect(await attempts(new NotFoundError('gone'))).toBe(1);
  });

  it('retries a 5xx or a network failure once', async () => {
    expect(await attempts(new ApiError(502, 'HTTP 502'))).toBe(2);
    expect(await attempts(new TypeError('Failed to fetch'))).toBe(2);
  });

  it('does not retry a timeout, so its message shows after one 15 s wait instead of two', async () => {
    expect(await attempts(new RequestTimeoutError(15_000))).toBe(1);
    expect(await attempts(new TimeoutError('Request timed out after 15000 ms'))).toBe(1);
  });

  it('retries a 429 once, but not when the wait is long', async () => {
    expect(await attempts(new ApiError(429, 'Too many', undefined, 2))).toBe(2);
    expect(await attempts(new RateLimitError('Too many', 5))).toBe(2);
    expect(await attempts(new ApiError(429, 'Too many', undefined, 120))).toBe(1);
    // a wait people would sit through in front of skeletons is said instead
    expect(await attempts(new ApiError(429, 'Too many', undefined, 30))).toBe(1);
  });

  it('waits as long as the server asked before a retry', () => {
    expect(retryDelay(0, new ApiError(429, 'Too many', undefined, 4))).toBe(4000);
    expect(retryDelay(0, new RateLimitError('Too many', 90))).toBe(30_000);
    expect(retryDelay(0, new ApiError(502, 'down'))).toBe(1000);
    expect(retryDelay(1, new TypeError('Failed to fetch'))).toBe(2000);
  });

  it('reports a 401 so the auth gate can sign out', async () => {
    const seen = vi.fn();
    const stop = onUnauthorized(seen);
    expect(await attempts(new ApiError(401, 'Not signed in'))).toBe(1);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@sluby/sdk';
import { ApiError } from './api-client';
import { createQueryClient } from './query-client';
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

  it('reports a 401 so the auth gate can sign out', async () => {
    const seen = vi.fn();
    const stop = onUnauthorized(seen);
    expect(await attempts(new ApiError(401, 'Not signed in'))).toBe(1);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });
});

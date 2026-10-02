import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from './api-client';

function respond(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('apiClient', () => {
  it('calls same-origin /api/v1 paths with no Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.post('/keys', { name: 'k' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/keys');
    expect((init.headers as Headers).get('Authorization')).toBeNull();
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('{"name":"k"}');
  });

  it('surfaces the server error message and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(403, { error: 'Insufficient scope' })),
    );

    const err = await apiClient.get('/keys').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, message: 'Insufficient scope' });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiClient.delete('/keys/1')).resolves.toBeUndefined();
  });
});

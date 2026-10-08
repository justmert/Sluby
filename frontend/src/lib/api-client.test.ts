import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, NotFoundError, SlubyError } from '@sluby/sdk';
import {
  apiClient,
  ApiError,
  parseRetryAfter,
  RequestTimeoutError,
  retryAfterOf,
  statusOf,
} from './api-client';

function respond(status: number, body: unknown, contentType = 'application/json') {
  return new Response(
    body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': contentType } },
  );
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

  it('surfaces the server error message, status and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(400, { error: 'Validation failed', details: [{ field: 'name' }] }),
        ),
    );

    const err = await apiClient.get('/keys').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      message: 'Validation failed',
      details: [{ field: 'name' }],
    });
  });

  it('returns undefined for 204 and for an empty json body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiClient.delete('/keys/1')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, '')));
    await expect(apiClient.get('/stats')).resolves.toBeUndefined();
  });

  it('turns malformed json into an ApiError instead of a raw SyntaxError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, '{"cut off')));
    const err = await apiClient.get('/stats').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, message: 'The server answered with malformed JSON' });
  });

  it('only takes a string as the error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(500, { error: { code: 'E_BROKEN' } })),
    );
    const err = await apiClient.get('/stats').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, message: 'HTTP 500' });
  });

  it('keeps the status line for an html error page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(502, '<html>Bad Gateway</html>', 'text/html')),
    );
    const err = await apiClient.get('/auth/me').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, message: 'HTTP 502' });
  });
});

describe('apiClient limits', () => {
  it('reads Retry-After from a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'Retry-After': '7' },
        }),
      ),
    );
    const err = await apiClient.post('/keys', {}).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfter: 7 });
    expect(retryAfterOf(err)).toBe(7);
  });

  it('gives up with a timeout error when no answer comes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          }),
      ),
    );
    const err = await apiClient.get('/stats', { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(statusOf(err)).toBeUndefined();
  });

  it('passes a caller abort through as an abort, not a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          }),
      ),
    );
    const controller = new AbortController();
    const pending = apiClient.get('/stats', { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;
    expect(err).not.toBeInstanceOf(RequestTimeoutError);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and http dates', () => {
    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    const at = new Date(Date.now() + 60_000).toUTCString();
    expect(parseRetryAfter(at)).toBeGreaterThanOrEqual(58);
  });
});

describe('statusOf', () => {
  it('reads the status of api client and sdk errors alike', () => {
    expect(statusOf(new ApiError(401, 'Not signed in'))).toBe(401);
    expect(statusOf(new AuthenticationError('Not signed in'))).toBe(401);
    expect(statusOf(new NotFoundError('gone'))).toBe(404);
  });

  it('has no status for errors without a response', () => {
    expect(statusOf(new SlubyError('network down'))).toBeUndefined();
    expect(statusOf(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(statusOf('nope')).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiaStreamClient } from './client.js';
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  SiaStreamError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: getStatusText(status),
    headers: headersObj,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  };
  return statusTexts[status] ?? 'Unknown';
}

// ---------------------------------------------------------------------------
// Tests: Constructor
// ---------------------------------------------------------------------------

describe('SiaStreamClient constructor', () => {
  it('should throw if apiKey is empty', () => {
    expect(() => new SiaStreamClient({ apiKey: '', baseUrl: 'https://api.example.com' }))
      .toThrow('SiaStreamClient requires a non-empty apiKey.');
  });

  it('should throw if baseUrl is empty', () => {
    expect(() => new SiaStreamClient({ apiKey: 'wss_test', baseUrl: '' }))
      .toThrow('SiaStreamClient requires a non-empty baseUrl.');
  });

  it('should create an instance with valid config', () => {
    const client = new SiaStreamClient({
      apiKey: 'wss_test',
      baseUrl: 'https://api.example.com',
    });
    expect(client).toBeInstanceOf(SiaStreamClient);
    expect(client.uploads).toBeDefined();
    expect(client.assets).toBeDefined();
    expect(client.playback).toBeDefined();
    expect(client.webhooks).toBeDefined();
  });

  it('should strip trailing slash from baseUrl', () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(200, { data: [], total: 0, page: 1, limit: 20 }));
    vi.stubGlobal('fetch', mockFetch);

    const client = new SiaStreamClient({
      apiKey: 'wss_test',
      baseUrl: 'https://api.example.com/',
    });

    client.assets.list();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/assets',
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it('should strip multiple trailing slashes', () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(200, { data: [], total: 0, page: 1, limit: 20 }));
    vi.stubGlobal('fetch', mockFetch);

    const client = new SiaStreamClient({
      apiKey: 'wss_test',
      baseUrl: 'https://api.example.com///',
    });

    client.assets.list();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/assets',
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Tests: _fetch (via sub-managers)
// ---------------------------------------------------------------------------

describe('SiaStreamClient._fetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: SiaStreamClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new SiaStreamClient({
      apiKey: 'wss_test_key',
      baseUrl: 'https://api.siastream.io',
    });
  });

  it('should add Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await client.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer wss_test_key');
  });

  it('should set Accept: application/json by default', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await client.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('should not override an existing Accept header', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { video_asset_id: 'v1', upload_url: 'u1' }));

    await client.uploads.create({
      title: 'test',
      description: 'desc',
      accessTier: 'public',
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    // The uploads.create call sets Content-Type but not Accept, so Accept
    // should still be set to application/json by _fetch
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('should prepend baseUrl to path', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: 'abc' }));

    await client.assets.get('abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.siastream.io/api/v1/assets/abc',
      expect.any(Object),
    );
  });

  // ── Error mapping ────────────────────────────────────────────────────────

  it('should throw AuthenticationError on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(401, { error: 'Invalid API key' }),
    );

    await expect(client.assets.get('x')).rejects.toThrow(AuthenticationError);
  });

  it('should throw AuthenticationError on 403', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(403, { error: 'Forbidden' }),
    );

    await expect(client.assets.get('x')).rejects.toThrow(AuthenticationError);
  });

  it('should throw NotFoundError on 404', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(404, { error: 'Asset not found' }),
    );

    await expect(client.assets.get('x')).rejects.toThrow(NotFoundError);
  });

  it('should throw RateLimitError on 429 with retryAfter', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '30' }),
    );

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfter).toBe(30);
    }
  });

  it('should throw RateLimitError without retryAfter when header is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(429, { error: 'Rate limit exceeded' }),
    );

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfter).toBeUndefined();
    }
  });

  it('should throw SiaStreamError on 500', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(500, { error: 'Internal server error' }),
    );

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SiaStreamError);
      expect((e as SiaStreamError).statusCode).toBe(500);
    }
  });

  // ── Error message extraction ─────────────────────────────────────────────

  it('should extract error message from JSON "error" field', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(500, { error: 'Something broke' }),
    );

    await expect(client.assets.get('x')).rejects.toThrow('Something broke');
  });

  it('should extract error message from JSON "message" field', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(500, { message: 'Server unavailable' }),
    );

    await expect(client.assets.get('x')).rejects.toThrow('Server unavailable');
  });

  it('should use raw text when response is not JSON and is short', async () => {
    const textResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Bad gateway error'),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(textResponse);

    await expect(client.assets.get('x')).rejects.toThrow('Bad gateway error');
  });

  it('should fall back to statusText when body is unavailable', async () => {
    const failResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: () => Promise.reject(new Error()),
      text: () => Promise.reject(new Error('read failed')),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(failResponse);

    await expect(client.assets.get('x')).rejects.toThrow('Internal Server Error');
  });

  it('should preserve statusCode and responseBody on error', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(404, { error: 'not found' }),
    );

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      const err = e as NotFoundError;
      expect(err.statusCode).toBe(404);
      expect(err.responseBody).toBe('{"error":"not found"}');
    }
  });
});

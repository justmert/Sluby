import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlubyClient } from './client.js';
import {
  AuthenticationError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SlubyError,
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

describe('SlubyClient constructor', () => {
  it('should throw if apiKey is provided but empty', () => {
    expect(() => new SlubyClient({ apiKey: '', baseUrl: 'https://api.example.com' })).toThrow(
      /apiKey must be non-empty when provided/,
    );
  });

  it('allows omitting apiKey for a cookie session', () => {
    expect(() => new SlubyClient({ baseUrl: 'https://api.example.com' })).not.toThrow();
  });

  it('should throw if baseUrl is empty', () => {
    expect(() => new SlubyClient({ apiKey: 'sluby_test', baseUrl: '' })).toThrow(
      'SlubyClient requires a non-empty baseUrl.',
    );
  });

  it('should create an instance with valid config', () => {
    const client = new SlubyClient({
      apiKey: 'sluby_test',
      baseUrl: 'https://api.example.com',
    });
    expect(client).toBeInstanceOf(SlubyClient);
    expect(client.uploads).toBeDefined();
    expect(client.assets).toBeDefined();
    expect(client.playback).toBeDefined();
    expect(client.webhooks).toBeDefined();
  });

  it('should strip trailing slash from baseUrl', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { data: [], total: 0, page: 1, limit: 20 }));
    vi.stubGlobal('fetch', mockFetch);

    const client = new SlubyClient({
      apiKey: 'sluby_test',
      baseUrl: 'https://api.example.com/',
    });

    await client.assets.list();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/assets',
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it('should strip multiple trailing slashes', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, { data: [], total: 0, page: 1, limit: 20 }));
    vi.stubGlobal('fetch', mockFetch);

    const client = new SlubyClient({
      apiKey: 'sluby_test',
      baseUrl: 'https://api.example.com///',
    });

    await client.assets.list();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/assets',
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Tests: delivery URL resolution
// ---------------------------------------------------------------------------

describe('SlubyClient.resolveDeliveryUrl', () => {
  it('defaults the delivery base to the API base', () => {
    const client = new SlubyClient({ apiKey: 'k', baseUrl: 'https://api.sluby.app' });
    expect(client.resolveDeliveryUrl('/v1/objects/x')).toBe('https://api.sluby.app/v1/objects/x');
  });

  it('uses a distinct delivery base when provided (and trims its slash)', () => {
    const client = new SlubyClient({
      apiKey: 'k',
      baseUrl: 'https://api.sluby.app',
      deliveryBaseUrl: 'https://cache.sluby.app/',
    });
    expect(client.resolveDeliveryUrl('/v1/objects/x')).toBe('https://cache.sluby.app/v1/objects/x');
  });

  it('passes an already-absolute URL through unchanged', () => {
    const client = new SlubyClient({ apiKey: 'k', baseUrl: 'https://api.sluby.app' });
    expect(client.resolveDeliveryUrl('https://other.example/x')).toBe('https://other.example/x');
  });

  it('resolves playback URLs through the delivery base', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse(200, {
        playback_url: '/v1/objects/abc?type=manifest',
        poster_url: null,
        duration_ms: 1,
        resolution: '1x1',
        access_tier: 'public',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SlubyClient({
      apiKey: 'k',
      baseUrl: 'https://api.sluby.app',
      deliveryBaseUrl: 'https://cache.sluby.app',
    });
    const info = await client.playback.getUrl('abc');
    expect(info.playbackUrl).toBe('https://cache.sluby.app/v1/objects/abc?type=manifest');
    expect(info.playbackPath).toBe('/v1/objects/abc?type=manifest');

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Tests: _fetch (via sub-managers)
// ---------------------------------------------------------------------------

describe('SlubyClient._fetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: SlubyClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new SlubyClient({
      apiKey: 'sluby_test_key',
      baseUrl: 'https://api.sluby.app',
    });
  });

  it('should add Authorization header with Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await client.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer sluby_test_key');
  });

  it('omits Authorization and keeps default credentials without an apiKey', async () => {
    const sessionClient = new SlubyClient({ baseUrl: 'https://api.sluby.app' });
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await sessionClient.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).has('Authorization')).toBe(false);
    expect(init.credentials).toBeUndefined();
  });

  it('passes the configured credentials policy to fetch', async () => {
    const sessionClient = new SlubyClient({
      baseUrl: 'https://api.sluby.app',
      credentials: 'include',
    });
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await sessionClient.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
  });

  it('should set Accept: application/json by default', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: '123' }));

    await client.assets.get('123');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('should not override an existing Accept header', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: 'v1' }));

    // assets.update sets Content-Type but not Accept, so _fetch should still
    // default Accept to application/json.
    await client.assets.update('v1', { title: 'test' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('should prepend baseUrl to path', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: 'abc' }));

    await client.assets.get('abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sluby.app/api/v1/assets/abc',
      expect.any(Object),
    );
  });

  // ── Error mapping ────────────────────────────────────────────────────────

  it('should throw AuthenticationError on 401', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401, { error: 'Invalid API key' }));

    await expect(client.assets.get('x')).rejects.toThrow(AuthenticationError);
  });

  it('should throw PermissionError on 403', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(403, { error: 'Forbidden' }));

    await expect(client.assets.get('x')).rejects.toThrow(PermissionError);
  });

  it('should throw NotFoundError on 404', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: 'Asset not found' }));

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
    fetchMock.mockResolvedValueOnce(makeResponse(429, { error: 'Rate limit exceeded' }));

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfter).toBeUndefined();
    }
  });

  it('should throw SlubyError on 500', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: 'Internal server error' }));

    try {
      await client.assets.get('x');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SlubyError);
      expect((e as SlubyError).statusCode).toBe(500);
    }
  });

  // ── Error message extraction ─────────────────────────────────────────────

  it('should extract error message from JSON "error" field', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: 'Something broke' }));

    await expect(client.assets.get('x')).rejects.toThrow('Something broke');
  });

  it('should extract error message from JSON "message" field', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { message: 'Server unavailable' }));

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
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: 'not found' }));

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

describe('SlubyClient direct-from-Sia share maps', () => {
  const sia = {
    indexerUrl: 'https://sia.storage',
    appId: 'ab'.repeat(32),
    appKey: 'cd'.repeat(32),
  };
  const shareBody = {
    master_object_id: 'm',
    shares: { m: 'sia://m#k' },
    expires_at: '2099-01-01T00:00:00Z',
  };

  it('fetches the public share map from the delivery base with no key, even when one is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, shareBody));
    vi.stubGlobal('fetch', mockFetch);
    try {
      const client = new SlubyClient({
        apiKey: 'sluby_secret',
        baseUrl: 'https://api.example.com',
        deliveryBaseUrl: 'https://cdn.example.com',
        credentials: 'include',
        sia,
      });

      const src = client.playback.streamUrl('pb_abc');
      const map = await client.sia!.getShareMap('pb_abc', { src });

      expect(src).toBe('https://cdn.example.com/v1/stream/pb_abc/master.m3u8');
      expect(map.masterObjectId).toBe('m');
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://cdn.example.com/v1/share/pb_abc');
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      expect(init.credentials).toBe('omit');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('turns a 403 from the public share map into a PermissionError', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeResponse(403, { error: 'This share map requires a valid signed URL' }),
      );
    vi.stubGlobal('fetch', mockFetch);
    try {
      const client = new SlubyClient({ baseUrl: 'https://api.example.com', sia });

      await expect(
        client.sia!.getShareMap('a', { src: '/v1/stream/a/master.m3u8' }),
      ).rejects.toBeInstanceOf(PermissionError);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/v1/share/a');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the authenticated api route when no src is given', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, shareBody));
    vi.stubGlobal('fetch', mockFetch);
    try {
      const client = new SlubyClient({
        apiKey: 'sluby_secret',
        baseUrl: 'https://api.example.com',
        sia,
      });

      await client.sia!.getShareMap('asset-1');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/api/v1/playback/asset-1/share');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sluby_secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

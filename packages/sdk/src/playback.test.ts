import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackManager } from './playback.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

const resolve = (pathOrUrl: string): string =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `https://delivery.test${pathOrUrl}`;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('PlaybackManager.getUrl()', () => {
  it('resolves the relative manifest path against the delivery base', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        playback_url: '/v1/objects/abc?type=manifest',
        poster_url: '/v1/objects/thumb0',
        duration_ms: 60000,
        resolution: '1280x720',
        access_tier: 'public',
      }),
    );

    const manager = new PlaybackManager(mockFetch, resolve);
    const result = await manager.getUrl('abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc', { signal: undefined });
    expect(result).toEqual({
      playbackUrl: 'https://delivery.test/v1/objects/abc?type=manifest',
      playbackPath: '/v1/objects/abc?type=manifest',
      posterUrl: 'https://delivery.test/v1/objects/thumb0',
      durationMs: 60000,
      resolution: '1280x720',
      accessTier: 'public',
    });
  });

  it('passes an already-absolute URL through unchanged', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        playback_url: 'https://cdn.sluby.app/v/abc/master.m3u8',
        poster_url: null,
        duration_ms: 0,
        resolution: '',
        access_tier: 'public',
      }),
    );

    const manager = new PlaybackManager(mockFetch, resolve);
    const result = await manager.getUrl('abc');

    expect(result.playbackUrl).toBe('https://cdn.sluby.app/v/abc/master.m3u8');
    expect(result.posterUrl).toBeNull();
  });

  it('should encode the video asset ID', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        playback_url: '/u',
        poster_url: null,
        duration_ms: 0,
        resolution: '',
        access_tier: 'public',
      }),
    );

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getUrl('id/with/slashes');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/id%2Fwith%2Fslashes', {
      signal: undefined,
    });
  });
});

describe('PlaybackManager.getSignedUrl()', () => {
  it('resolves the signed path and keeps the raw path', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: '/v1/objects/abc?type=manifest&expires=1&sig=xyz',
        expires_at: '2025-06-01T00:00:00Z',
      }),
    );

    const manager = new PlaybackManager(mockFetch, resolve);
    const result = await manager.getSignedUrl('abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed', { signal: undefined });
    expect(result).toEqual({
      signedUrl: 'https://delivery.test/v1/objects/abc?type=manifest&expires=1&sig=xyz',
      signedPath: '/v1/objects/abc?type=manifest&expires=1&sig=xyz',
      posterUrl: null,
      expiresAt: '2025-06-01T00:00:00Z',
    });
  });

  it('maps the signed poster, resolved like the manifest', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'https://api.test/v1/objects/abc?type=manifest&expires=1&sig=xyz',
        poster_url: 'https://api.test/v1/objects/t1?type=poster&expires=1&sig=p',
        expires_at: '2025-06-01T00:00:00Z',
      }),
    );

    const result = await new PlaybackManager(mockFetch, resolve).getSignedUrl('abc');

    expect(result.posterUrl).toBe('https://api.test/v1/objects/t1?type=poster&expires=1&sig=p');
  });

  it('keeps a relative signed poster on the delivery base', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: '/v1/objects/abc?expires=1&sig=xyz',
        poster_url: '/v1/objects/t1?expires=1&sig=p',
        expires_at: '2025-06-01T00:00:00Z',
      }),
    );

    const result = await new PlaybackManager(mockFetch, resolve).getSignedUrl('abc');

    expect(result.posterUrl).toBe('https://delivery.test/v1/objects/t1?expires=1&sig=p');
  });

  it('should include expires_in query param when provided', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: '/u',
        expires_at: '2025-06-01T01:00:00Z',
      }),
    );

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getSignedUrl('abc', { expiresIn: 7200 });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/abc/signed?expires_in=7200');
  });

  it('should not add query param when expiresIn is undefined', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ signed_url: '/u', expires_at: 'e' }));

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getSignedUrl('abc', {});

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed', { signal: undefined });
  });

  it('refuses an expiresIn that is not a positive whole number of seconds', async () => {
    // the backend reads 0 (or garbage) as "use the default", which would hand
    // back an hour-long url for a caller that asked for none
    const manager = new PlaybackManager(mockFetch, resolve);

    for (const expiresIn of [0, -5, 1.5, Number.NaN]) {
      await expect(manager.getSignedUrl('abc', { expiresIn })).rejects.toThrow(RangeError);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should encode the video asset ID in the signed URL path', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ signed_url: '/u', expires_at: 'e' }));

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getSignedUrl('id/special');

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/id%2Fspecial/signed');
  });
});

describe('PlaybackManager.streamUrl()', () => {
  it('builds the public master url on the delivery base without a request', () => {
    const manager = new PlaybackManager(mockFetch, resolve);

    expect(manager.streamUrl('asset-1')).toBe(
      'https://delivery.test/v1/stream/asset-1/master.m3u8',
    );
    expect(manager.streamUrl('pb_abc')).toBe('https://delivery.test/v1/stream/pb_abc/master.m3u8');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('encodes the id', () => {
    const manager = new PlaybackManager(mockFetch, resolve);

    expect(manager.streamUrl('a/b')).toBe('https://delivery.test/v1/stream/a%2Fb/master.m3u8');
  });
});

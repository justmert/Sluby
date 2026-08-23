import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackManager } from './playback.js';
import type { FetchFn } from './uploads.js';

// ---------------------------------------------------------------------------
// Mock fetch function + a delivery-URL resolver matching SlubyClient's.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests: getUrl()
// ---------------------------------------------------------------------------

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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc');
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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/id%2Fwith%2Fslashes');
  });
});

// ---------------------------------------------------------------------------
// Tests: getSignedUrl()
// ---------------------------------------------------------------------------

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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed');
    expect(result).toEqual({
      signedUrl: 'https://delivery.test/v1/objects/abc?type=manifest&expires=1&sig=xyz',
      signedPath: '/v1/objects/abc?type=manifest&expires=1&sig=xyz',
      expiresAt: '2025-06-01T00:00:00Z',
    });
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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed');
  });

  it('should handle expiresIn of 0', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ signed_url: '/u', expires_at: 'e' }));

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getSignedUrl('abc', { expiresIn: 0 });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/abc/signed?expires_in=0');
  });

  it('should encode the video asset ID in the signed URL path', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ signed_url: '/u', expires_at: 'e' }));

    const manager = new PlaybackManager(mockFetch, resolve);
    await manager.getSignedUrl('id/special');

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/id%2Fspecial/signed');
  });
});

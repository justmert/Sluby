import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackManager } from './playback.js';
import type { FetchFn } from './uploads.js';

// ---------------------------------------------------------------------------
// Mock fetch function
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

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
  it('should GET /api/v1/playback/:id and map snake_case response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        playback_url: 'https://cdn.sluby.app/v/abc/master.m3u8',
        poster_url: 'https://cdn.sluby.app/v/abc/poster.jpg',
        duration_ms: 60000,
        resolution: '1280x720',
        access_tier: 'public',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    const result = await manager.getUrl('abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc');
    expect(result).toEqual({
      playbackUrl: 'https://cdn.sluby.app/v/abc/master.m3u8',
      posterUrl: 'https://cdn.sluby.app/v/abc/poster.jpg',
      durationMs: 60000,
      resolution: '1280x720',
      accessTier: 'public',
    });
  });

  it('should encode the video asset ID', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        playback_url: 'u',
        poster_url: 'p',
        duration_ms: 0,
        resolution: '',
        access_tier: 'public',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    await manager.getUrl('id/with/slashes');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/id%2Fwith%2Fslashes');
  });
});

// ---------------------------------------------------------------------------
// Tests: getSignedUrl()
// ---------------------------------------------------------------------------

describe('PlaybackManager.getSignedUrl()', () => {
  it('should GET /api/v1/playback/:id/signed without params when no options', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'https://cdn.sluby.app/v/abc/master.m3u8?token=xyz',
        expires_at: '2025-06-01T00:00:00Z',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    const result = await manager.getSignedUrl('abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed');
    expect(result).toEqual({
      signedUrl: 'https://cdn.sluby.app/v/abc/master.m3u8?token=xyz',
      expiresAt: '2025-06-01T00:00:00Z',
    });
  });

  it('should include expires_in query param when provided', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'https://cdn.sluby.app/v/abc/master.m3u8?token=xyz',
        expires_at: '2025-06-01T01:00:00Z',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    await manager.getSignedUrl('abc', { expiresIn: 7200 });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/abc/signed?expires_in=7200');
  });

  it('should not add query param when expiresIn is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'u',
        expires_at: 'e',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    await manager.getSignedUrl('abc', {});

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback/abc/signed');
  });

  it('should handle expiresIn of 0', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'u',
        expires_at: 'e',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    await manager.getSignedUrl('abc', { expiresIn: 0 });

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/abc/signed?expires_in=0');
  });

  it('should encode the video asset ID in the signed URL path', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        signed_url: 'u',
        expires_at: 'e',
      }),
    );

    const manager = new PlaybackManager(mockFetch);
    await manager.getSignedUrl('id/special');

    const calledPath = mockFetch.mock.calls[0][0] as string;
    expect(calledPath).toBe('/api/v1/playback/id%2Fspecial/signed');
  });
});

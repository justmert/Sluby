// ---------------------------------------------------------------------------
// @sluby/sdk - PlaybackManager
// ---------------------------------------------------------------------------

import type { AccessTier, PlaybackInfo, SignedPlaybackInfo } from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * Manages retrieval of playback URLs (public and signed) for video assets.
 */
export class PlaybackManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/playback/:id
  // -----------------------------------------------------------------------

  /**
   * Retrieve the public playback information for a video asset including
   * the HLS manifest URL, poster image, duration, and resolution.
   */
  async getUrl(videoAssetId: string): Promise<PlaybackInfo> {
    const res = await this._fetch(`/api/v1/playback/${encodeURIComponent(videoAssetId)}`);
    const body = await res.json();

    return {
      playbackUrl: body.playback_url as string,
      posterUrl: body.poster_url as string,
      durationMs: body.duration_ms as number,
      resolution: body.resolution as string,
      accessTier: body.access_tier as AccessTier,
    };
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/playback/:id/signed
  // -----------------------------------------------------------------------

  /**
   * Retrieve a time-limited signed playback URL for gated / private
   * content.
   *
   * @param videoAssetId - Asset identifier.
   * @param options.expiresIn - Lifetime of the signed URL in seconds.
   *   Defaults to the server-side default (typically 3600).
   */
  async getSignedUrl(
    videoAssetId: string,
    options?: { expiresIn?: number },
  ): Promise<SignedPlaybackInfo> {
    const params = new URLSearchParams();
    if (options?.expiresIn != null) {
      params.set('expires_in', String(options.expiresIn));
    }

    const query = params.toString();
    const path = `/api/v1/playback/${encodeURIComponent(videoAssetId)}/signed${
      query ? `?${query}` : ''
    }`;

    const res = await this._fetch(path);
    const body = await res.json();

    return {
      signedUrl: body.signed_url as string,
      expiresAt: body.expires_at as string,
    };
  }
}

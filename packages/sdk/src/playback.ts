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
  private readonly _resolveDeliveryUrl: (pathOrUrl: string) => string;

  constructor(fetchFn: FetchFn, resolveDeliveryUrl: (pathOrUrl: string) => string) {
    this._fetch = fetchFn;
    this._resolveDeliveryUrl = resolveDeliveryUrl;
  }

  // -----------------------------------------------------------------------
  // /v1/stream/:id/master.m3u8 (no request)
  // -----------------------------------------------------------------------

  /**
   * The absolute public master manifest URL for an asset id or a `pb_...`
   * playback id, on the delivery base. Builds the URL without a request and
   * without a key: the gateway serves a public asset (or a public playback id)
   * to anyone. A private asset or a signed playback id needs a signed URL
   * from `getSignedUrl` instead.
   */
  streamUrl(idOrPlaybackId: string): string {
    return this._resolveDeliveryUrl(`/v1/stream/${encodeURIComponent(idOrPlaybackId)}/master.m3u8`);
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

    const playbackPath = body.playback_url as string;
    const posterPath = (body.poster_url as string | null) ?? null;

    return {
      playbackUrl: this._resolveDeliveryUrl(playbackPath),
      playbackPath,
      posterUrl: posterPath ? this._resolveDeliveryUrl(posterPath) : null,
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

    const signedPath = body.signed_url as string;

    return {
      signedUrl: this._resolveDeliveryUrl(signedPath),
      signedPath,
      expiresAt: body.expires_at as string,
    };
  }
}

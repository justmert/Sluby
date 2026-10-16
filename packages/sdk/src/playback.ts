// ---------------------------------------------------------------------------
// @sluby/sdk - PlaybackManager
// ---------------------------------------------------------------------------

import { readJson } from './errors.js';
import type { AccessTier, PlaybackInfo, RequestOptions, SignedPlaybackInfo } from './types.js';
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
  async getUrl(videoAssetId: string, options?: RequestOptions): Promise<PlaybackInfo> {
    const res = await this._fetch(`/api/v1/playback/${encodeURIComponent(videoAssetId)}`, {
      signal: options?.signal,
    });
    const body = await readJson(res);

    const playbackPath = body.playback_url as string;
    const posterPath = (body.poster_url as string | null) ?? null;

    return {
      playbackUrl: this._resolveDeliveryUrl(playbackPath),
      playbackPath,
      posterUrl: posterPath ? this._resolveDeliveryUrl(posterPath) : null,
      durationMs: (body.duration_ms as number | null | undefined) ?? null,
      resolution: (body.resolution as string | null | undefined) ?? null,
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
   *   Defaults to the server-side default (3600); the server keeps it between
   *   60 and 21600 (six hours). The manifest and every playlist and segment it
   *   lists stop working at `expiresAt`, or earlier when the asset's tier
   *   changes or its signed URLs are revoked, so a player has to fetch a new
   *   URL before then to keep playing.
   * @param options.signal - Cancels the request.
   */
  async getSignedUrl(
    videoAssetId: string,
    options?: { expiresIn?: number; signal?: AbortSignal },
  ): Promise<SignedPlaybackInfo> {
    const params = new URLSearchParams();
    if (options?.expiresIn != null) {
      // the backend reads 0 or a fraction as "use the default", which is not what was asked for
      if (!Number.isInteger(options.expiresIn) || options.expiresIn <= 0) {
        throw new RangeError(
          `expiresIn must be a positive whole number of seconds, got ${options.expiresIn}.`,
        );
      }
      params.set('expires_in', String(options.expiresIn));
    }

    const query = params.toString();
    const path = `/api/v1/playback/${encodeURIComponent(videoAssetId)}/signed${
      query ? `?${query}` : ''
    }`;

    const res = await this._fetch(path, { signal: options?.signal });
    const body = await readJson(res);

    const signedPath = body.signed_url as string;
    // servers before 0.2 sent no poster
    const posterPath = (body.poster_url as string | null | undefined) ?? null;

    return {
      signedUrl: this._resolveDeliveryUrl(signedPath),
      signedPath,
      posterUrl: posterPath ? this._resolveDeliveryUrl(posterPath) : null,
      expiresAt: body.expires_at as string,
    };
  }
}

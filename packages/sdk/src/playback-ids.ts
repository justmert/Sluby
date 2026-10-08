import { readJson } from './errors.js';
import type { CreatePlaybackIdInput, PlaybackId, PlaybackPolicy, RequestOptions } from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * Manages playback ids: public `pb_...` handles for an asset that can be
 * embedded and revoked without exposing the asset id. Listing needs the
 * `read` scope, creating and deleting `manage`.
 */
export class PlaybackIdManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  /** The asset's playback ids. */
  async list(videoAssetId: string, options?: RequestOptions): Promise<PlaybackId[]> {
    const res = await this._fetch(
      `/api/v1/assets/${encodeURIComponent(videoAssetId)}/playback-ids`,
      { signal: options?.signal },
    );
    const body = await readJson(res);
    return (body.data as Array<Record<string, unknown>>).map(mapPlaybackId);
  }

  /**
   * Create a playback id for the asset. A `signed` one plays only through a
   * signed URL; it does not make a public asset's bytes private.
   */
  async create(
    videoAssetId: string,
    input?: CreatePlaybackIdInput,
    options?: RequestOptions,
  ): Promise<PlaybackId> {
    const payload: Record<string, unknown> = {};
    if (input?.policy !== undefined) payload.policy = input.policy;
    if (input?.name !== undefined) payload.name = input.name;

    const res = await this._fetch(
      `/api/v1/assets/${encodeURIComponent(videoAssetId)}/playback-ids`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: options?.signal,
      },
    );
    return mapPlaybackId(await readJson(res));
  }

  /** Delete a playback id by its public `pb_...` handle; URLs using it stop working. */
  async delete(playbackId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/playback-ids/${encodeURIComponent(playbackId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }
}

function mapPlaybackId(raw: Record<string, unknown>): PlaybackId {
  return {
    id: raw.id as string,
    playbackId: raw.playback_id as string,
    policy: raw.policy as PlaybackPolicy,
    name: (raw.name as string | null | undefined) ?? '',
    createdAt: raw.created_at as string,
  };
}

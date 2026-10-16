// ---------------------------------------------------------------------------
// @sluby/sdk - KeyManager
// ---------------------------------------------------------------------------

import { readJson } from './errors.js';
import type {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyInput,
  CreatedApiKey,
  CursorPage,
  ListApiKeysOptions,
  RequestOptions,
  RotatedApiKey,
} from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * Manages the account's API keys. Every call needs a key (or session) with
 * the `manage` scope.
 */
export class KeyManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/keys
  // -----------------------------------------------------------------------

  /**
   * One page of the account's usable keys, newest first. A key being rotated
   * out stays listed, with its `expiresAt`, until its grace period ends. Pass
   * each page's `nextCursor` back as `cursor` for the next one.
   */
  async list(options?: ListApiKeysOptions): Promise<CursorPage<ApiKey>> {
    const params = new URLSearchParams();
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.cursor) params.set('cursor', options.cursor);

    const query = params.toString();
    const res = await this._fetch(`/api/v1/keys${query ? `?${query}` : ''}`, {
      signal: options?.signal,
    });
    const body = await readJson(res);
    return {
      data: (body.data as Array<Record<string, unknown>>).map(mapKey),
      hasMore: body.has_more === true,
      nextCursor: (body.next_cursor as string | null | undefined) ?? null,
    };
  }

  // -----------------------------------------------------------------------
  // POST /api/v1/keys
  // -----------------------------------------------------------------------

  /** Create a key for the account. The raw `key` is only ever returned here. */
  async create(input: CreateApiKeyInput, options?: RequestOptions): Promise<CreatedApiKey> {
    const payload: Record<string, unknown> = { name: input.name };
    if (input.scopes !== undefined) payload.scopes = input.scopes;
    if (input.rateLimit !== undefined) payload.rate_limit = input.rateLimit;

    const res = await this._fetch('/api/v1/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });
    const body = await readJson(res);
    return { ...mapKey(body), key: body.key as string };
  }

  // -----------------------------------------------------------------------
  // POST /api/v1/keys/:id/rotate
  // -----------------------------------------------------------------------

  /**
   * Replace a key with a new secret that keeps its name, scopes and rate
   * limit. The old key stops working now, or after `gracePeriodSeconds` (up
   * to a week) so deployments can switch over. A key that was already rotated
   * rejects with a `ConflictError`: rotate its replacement.
   */
  async rotate(
    keyId: string,
    options?: { gracePeriodSeconds?: number; signal?: AbortSignal },
  ): Promise<RotatedApiKey> {
    const init: RequestInit = { method: 'POST', signal: options?.signal };
    if (options?.gracePeriodSeconds !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify({ grace_period_seconds: options.gracePeriodSeconds });
    }
    const res = await this._fetch(`/api/v1/keys/${encodeURIComponent(keyId)}/rotate`, init);
    const body = await readJson(res);
    return {
      ...mapKey(body),
      key: body.key as string,
      rotatedFrom: body.rotated_from as string,
      previousKeyExpiresAt: body.previous_key_expires_at as string,
    };
  }

  // -----------------------------------------------------------------------
  // DELETE /api/v1/keys/:id
  // -----------------------------------------------------------------------

  /** Revoke a key now. */
  async revoke(keyId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }
}

function mapKey(raw: Record<string, unknown>): ApiKey {
  return {
    id: raw.id as string,
    name: raw.name as string,
    scopes: raw.scopes as ApiKeyScope[],
    rateLimit: raw.rate_limit as number,
    isActive: raw.is_active as boolean,
    createdAt: raw.created_at as string,
    expiresAt: (raw.expires_at as string | null | undefined) ?? null,
  };
}

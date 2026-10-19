import { readJson } from './errors.js';
import type {
  ApiKey,
  ApiKeyPage,
  ApiKeyScope,
  CreateApiKeyInput,
  CreatedApiKey,
  ListApiKeysOptions,
  RequestOptions,
  RotatedApiKey,
} from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * Manages the workspace's API keys. Every call needs a key (or session) with
 * the `manage` scope.
 */
export class KeyManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  /**
   * One page of the workspace's usable keys, newest first. A key being rotated
   * out stays listed, with its `expiresAt`, until its grace period ends. Pass
   * each page's `nextCursor` back as `cursor` for the next one. `limits` are
   * the server's caps, to check a new key against before creating it.
   */
  async list(options?: ListApiKeysOptions): Promise<ApiKeyPage> {
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
      limits: {
        maxKeys: (body.limits as { max_keys: number }).max_keys,
        maxRateLimit: (body.limits as { max_rate_limit: number }).max_rate_limit,
      },
    };
  }

  /** Rename a key. Its secret, scopes and rate limit stay as they are. */
  async update(keyId: string, input: { name: string }, options?: RequestOptions): Promise<ApiKey> {
    const res = await this._fetch(`/api/v1/keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name }),
      signal: options?.signal,
    });
    return mapKey(await readJson(res));
  }

  /**
   * Create a key in the workspace, made by the caller, so it acts with the
   * caller's role. The raw `key` is only ever returned here.
   */
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
    prefix: (raw.prefix as string | null | undefined) ?? null,
    lastUsedAt: (raw.last_used_at as string | null | undefined) ?? null,
    createdBy: mapCreator(raw.created_by),
  };
}

// servers from before members send no created_by
function mapCreator(raw: unknown): ApiKey['createdBy'] {
  if (raw === null || typeof raw !== 'object') return null;
  const creator = raw as { id: string; name: string };
  return { id: creator.id, name: creator.name };
}

import { readJson } from './errors.js';
import type { RequestOptions, StudioSession } from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * The browsers signed in to the account's Studio. These calls work only with
 * a browser session (a client without `apiKey`, sending the session cookie);
 * an API key gets an `AuthenticationError`, since keys are managed with
 * `client.keys`.
 */
export class SessionManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  /** The account's live sessions, newest first, marking the one making the call. */
  async list(options?: RequestOptions): Promise<StudioSession[]> {
    const res = await this._fetch('/api/v1/auth/sessions', { signal: options?.signal });
    const body = await readJson(res);
    return (body.data as Array<Record<string, unknown>>).map((raw) => ({
      id: raw.id as string,
      userAgent: (raw.user_agent as string | null | undefined) ?? null,
      createdAt: raw.created_at as string,
      expiresAt: raw.expires_at as string,
      lastSeenAt: (raw.last_seen_at as string | null | undefined) ?? null,
      current: raw.current === true,
    }));
  }

  /** Sign one browser out. Signing out the current one also clears its cookie. */
  async revoke(sessionId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }

  /** Sign every browser out, this one included. Returns how many were signed out. */
  async revokeAll(options?: RequestOptions): Promise<{ revoked: number }> {
    const res = await this._fetch('/api/v1/auth/sessions', {
      method: 'DELETE',
      signal: options?.signal,
    });
    const body = await readJson(res);
    return { revoked: body.revoked as number };
  }
}

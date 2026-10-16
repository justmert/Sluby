import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from './sessions.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('SessionManager', () => {
  it('lists the sessions with when each was last used', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        data: [
          {
            id: 's1',
            user_agent: 'Firefox',
            created_at: '2026-10-01T00:00:00.000Z',
            expires_at: '2026-10-08T00:00:00.000Z',
            last_seen_at: '2026-10-02T00:00:00.000Z',
            current: true,
          },
          {
            id: 's2',
            user_agent: null,
            created_at: '2026-10-01T00:00:00.000Z',
            expires_at: '2026-10-08T00:00:00.000Z',
            last_seen_at: null,
            current: false,
          },
        ],
      }),
    );
    const sessions = await new SessionManager(mockFetch).list();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/sessions', { signal: undefined });
    expect(sessions).toEqual([
      {
        id: 's1',
        userAgent: 'Firefox',
        createdAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2026-10-08T00:00:00.000Z',
        lastSeenAt: '2026-10-02T00:00:00.000Z',
        current: true,
      },
      {
        id: 's2',
        userAgent: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2026-10-08T00:00:00.000Z',
        lastSeenAt: null,
        current: false,
      },
    ]);
  });

  it('signs one browser out, and all of them', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true, revoked: 3 }));
    const sessions = new SessionManager(mockFetch);
    await sessions.revoke('s 2');
    expect(await sessions.revokeAll()).toEqual({ revoked: 3 });
    expect(mockFetch.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['/api/v1/auth/sessions/s%202', 'DELETE'],
      ['/api/v1/auth/sessions', 'DELETE'],
    ]);
  });
});

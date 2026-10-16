import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyManager } from './keys.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const RAW_KEY = {
  id: 'k1',
  name: 'ci',
  scopes: ['upload', 'read'],
  rate_limit: 100,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
};

const MAPPED_KEY = {
  id: 'k1',
  name: 'ci',
  scopes: ['upload', 'read'],
  rateLimit: 100,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
};

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('KeyManager.list()', () => {
  it('gets the first page without a query and maps it', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ data: [RAW_KEY], has_more: true, next_cursor: 'c2' }),
    );

    const page = await new KeyManager(mockFetch).list();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/keys', { signal: undefined });
    expect(page).toEqual({ data: [MAPPED_KEY], hasMore: true, nextCursor: 'c2' });
  });

  it('sends limit and cursor and reads the last page', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        data: [{ ...RAW_KEY, expires_at: '2026-01-02T00:00:00.000Z' }],
        has_more: false,
        next_cursor: null,
      }),
    );
    const controller = new AbortController();

    const page = await new KeyManager(mockFetch).list({
      limit: 1,
      cursor: 'a b',
      signal: controller.signal,
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/keys?limit=1&cursor=a+b', {
      signal: controller.signal,
    });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.data[0].expiresAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('KeyManager.create()', () => {
  it('posts snake_case fields and returns the key with its secret', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ...RAW_KEY, scopes: ['manage'], rate_limit: 50, key: 'sluby_x' }),
    );

    const created = await new KeyManager(mockFetch).create({
      name: 'ci',
      scopes: ['manage'],
      rateLimit: 50,
    });

    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/v1/keys');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'ci',
      scopes: ['manage'],
      rate_limit: 50,
    });
    expect(created).toEqual({ ...MAPPED_KEY, scopes: ['manage'], rateLimit: 50, key: 'sluby_x' });
  });

  it('leaves out the fields that were not given, so the server defaults apply', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...RAW_KEY, key: 'sluby_x' }));

    await new KeyManager(mockFetch).create({ name: 'ci' });

    expect(JSON.parse(mockFetch.mock.calls[0][1]?.body as string)).toEqual({ name: 'ci' });
  });
});

describe('KeyManager.rotate()', () => {
  const rotated = {
    ...RAW_KEY,
    id: 'k2',
    key: 'sluby_new',
    rotated_from: 'k1',
    previous_key_expires_at: '2026-01-01T01:00:00.000Z',
  };

  it('posts the grace period and maps the replacement', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(rotated));

    const result = await new KeyManager(mockFetch).rotate('k/1', { gracePeriodSeconds: 3600 });

    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/v1/keys/k%2F1/rotate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ grace_period_seconds: 3600 });
    expect(result).toEqual({
      ...MAPPED_KEY,
      id: 'k2',
      key: 'sluby_new',
      rotatedFrom: 'k1',
      previousKeyExpiresAt: '2026-01-01T01:00:00.000Z',
    });
  });

  it('sends no body without a grace period', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(rotated));

    await new KeyManager(mockFetch).rotate('k1');

    const init = mockFetch.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });
});

describe('KeyManager.revoke()', () => {
  it('sends DELETE to the key', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

    await new KeyManager(mockFetch).revoke('k1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/keys/k1', {
      method: 'DELETE',
      signal: undefined,
    });
  });
});

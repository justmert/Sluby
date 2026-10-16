import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackIdManager } from './playback-ids.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const RAW = {
  id: 'p1',
  playback_id: 'pb_abc',
  policy: 'signed',
  name: 'embed',
  created_at: '2026-01-01T00:00:00.000Z',
};
const MAPPED = {
  id: 'p1',
  playbackId: 'pb_abc',
  policy: 'signed',
  name: 'embed',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('PlaybackIdManager.list()', () => {
  it("gets the asset's playback ids and maps them", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ data: [RAW] }));

    const ids = await new PlaybackIdManager(mockFetch).list('a/1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/assets/a%2F1/playback-ids', {
      signal: undefined,
    });
    expect(ids).toEqual([MAPPED]);
  });
});

describe('PlaybackIdManager.create()', () => {
  it('posts the policy and name', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse(RAW));

    const created = await new PlaybackIdManager(mockFetch).create('a1', {
      policy: 'signed',
      name: 'embed',
    });

    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/api/v1/assets/a1/playback-ids');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({ policy: 'signed', name: 'embed' });
    expect(created).toEqual(MAPPED);
  });

  it('posts an empty object without input, so the server defaults apply', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ ...RAW, policy: 'public', name: '' }));

    const created = await new PlaybackIdManager(mockFetch).create('a1');

    expect(JSON.parse(mockFetch.mock.calls[0][1]?.body as string)).toEqual({});
    expect(created.policy).toBe('public');
    expect(created.name).toBe('');
  });
});

describe('PlaybackIdManager.delete()', () => {
  it('sends DELETE to the public handle', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

    await new PlaybackIdManager(mockFetch).delete('pb_abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/playback-ids/pb_abc', {
      method: 'DELETE',
      signal: undefined,
    });
  });
});

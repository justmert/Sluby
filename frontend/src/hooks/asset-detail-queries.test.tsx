import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConflictError, type ProcessingJob, type VideoAsset } from '@sluby/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextJobPoll,
  useUpdateVideo,
  JOB_POLL_FAST_MS,
  JOB_POLL_SLOW_MS,
} from './asset-detail-queries';

const wire = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Teaser',
  description: '',
  manifest_object_id: null,
  thumbnail_object_ids: [],
  duration_ms: null,
  resolution: null,
  status: 'ready',
  access_tier: 'public',
  creator_address: 'x',
  segment_count: 0,
  total_storage_bytes: 0,
  play_count: 0,
  last_played_at: null,
  created_at: '2026-10-09T00:00:00.000Z',
  updated_at: '2026-10-09T01:00:00.000Z',
  ...over,
});

const base = {
  id: 'a1',
  title: 'Teaser',
  description: '',
  updatedAt: '2026-10-09T01:00:00.000Z',
} as VideoAsset;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return {
    client,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useUpdateVideo', () => {
  it('sends only the changed field, with the version the edit started from as If-Match', async () => {
    const fetchStub = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify(wire({ title: 'New', updated_at: '2026-10-09T02:00:00.000Z' })),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const { client, Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateVideo(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ base, patch: { title: 'New' } }));

    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/assets\/a1$/);
    expect(init!.method).toBe('PATCH');
    expect(new Headers(init!.headers).get('If-Match')).toBe(
      `"${Date.parse('2026-10-09T01:00:00.000Z')}"`,
    );
    expect(JSON.parse(init!.body as string)).toEqual({ title: 'New' });
    expect(client.getQueryData<VideoAsset>(['assets', 'one', 'a1'])?.title).toBe('New');
  });

  it('rejects a stale edit with the video as it is now and leaves the cache alone (FLW-06)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'This video was changed somewhere else.',
              current: wire({ description: 'written in tab B' }),
            }),
            { status: 412, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const { client, Wrapper } = wrapper();
    client.setQueryData(['assets', 'one', 'a1'], base);
    const { result } = renderHook(() => useUpdateVideo(), { wrapper: Wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ base, patch: { title: 'Mine' } });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as ConflictError).statusCode).toBe(412);
    expect((caught as ConflictError).current?.description).toBe('written in tab B');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<VideoAsset>(['assets', 'one', 'a1'])?.title).toBe('Teaser');
  });
});

describe('nextJobPoll', () => {
  const job = (progressPercent: number) =>
    ({
      status: 'processing',
      stage: 'upload',
      progressPercent,
      logs: [],
    }) as unknown as ProcessingJob;

  it('polls fast while the job moves and slows down once it sits still (FLW-26)', () => {
    let state = { signature: '', at: 0 };
    let r = nextJobPoll(job(10), state, 1_000);
    expect(r.delay).toBe(JOB_POLL_FAST_MS);
    state = r.state;
    r = nextJobPoll(job(10), state, 9_000);
    expect(r.delay).toBe(JOB_POLL_FAST_MS);
    r = nextJobPoll(job(10), r.state, 11_500);
    expect(r.delay).toBe(JOB_POLL_SLOW_MS);
    // a change speeds it up again
    r = nextJobPoll(job(11), r.state, 21_500);
    expect(r.delay).toBe(JOB_POLL_FAST_MS);
  });
});

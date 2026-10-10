import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import { createQueryClient } from '@/lib/query-client';
import { onUnauthorized } from '@/lib/session-events';
import { jsonFetch, reply } from '@/test/render';
import { useLatestAssets } from './useLatestAssets';
import { useProcessingJob } from './asset-detail-queries';
import { sluby } from '@/lib/sluby';
import { findUpload, recordUpload } from '@/lib/upload-history';
import {
  fetchAllMatching,
  isInFlight,
  isStaleUpload,
  useAssetById,
  useAssetList,
  useDeleteAssets,
  useSetAccess,
  useStaleUploadCount,
} from './asset-queries';

const assetBody = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Clip',
  description: '',
  manifest_object_id: null,
  thumbnail_object_ids: [],
  duration_ms: null,
  resolution: null,
  status: 'processing',
  access_tier: 'public',
  creator_address: 'local:dev',
  segment_count: 0,
  total_storage_bytes: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

afterEach(() => vi.unstubAllGlobals());

describe('isInFlight', () => {
  const at = (status: VideoAsset['status'], createdAt: string) =>
    ({ status, createdAt }) as VideoAsset;
  const now = Date.parse('2026-10-07T12:00:00Z');

  it('counts processing assets and recent uploads, not finished or abandoned ones', () => {
    expect(isInFlight(at('processing', '2026-09-01T00:00:00Z'), now)).toBe(true);
    expect(isInFlight(at('created', '2026-10-07T11:55:00Z'), now)).toBe(true);
    expect(isInFlight(at('uploading', '2026-10-07T11:51:00Z'), now)).toBe(true);
    expect(isInFlight(at('ready', '2026-10-07T11:00:00Z'), now)).toBe(false);
    expect(isInFlight(at('failed', '2026-10-07T11:00:00Z'), now)).toBe(false);
  });

  it('stops counting an upload that has not moved for 10 minutes (FLW-12)', () => {
    // an hour old and still waiting for its file: the browser sending it is gone
    expect(isInFlight(at('created', '2026-10-07T11:00:00Z'), now)).toBe(false);
    expect(isInFlight(at('uploading', '2026-10-07T11:50:00Z'), now)).toBe(false);
    expect(isStaleUpload(at('created', '2026-10-07T11:50:00Z'), now)).toBe(true);
    expect(isStaleUpload(at('created', '2026-10-07T11:50:01Z'), now)).toBe(false);
    expect(isStaleUpload(at('processing', '2026-10-01T00:00:00Z'), now)).toBe(false);
  });
});

describe('asset hooks', () => {
  it('forgets that a deleted video was uploaded here, so its file reads as new again', async () => {
    const server = jsonFetch({
      'DELETE /api/v1/assets/a1': { success: true },
      'DELETE /api/v1/assets/a2': reply(404, { error: 'not found' }),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    recordUpload({ fingerprint: 'clip-1', title: 'Clip', assetId: 'a1', accountId: 'me' });
    recordUpload({ fingerprint: 'clip-2', title: 'Other', assetId: 'a2', accountId: 'me' });
    recordUpload({ fingerprint: 'clip-3', title: 'Kept', assetId: 'a3', accountId: 'me' });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteAssets(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync(['a1', 'a2']));
    expect(findUpload('clip-1', 'me')).toBeNull();
    // already gone counts as deleted
    expect(findUpload('clip-2', 'me')).toBeNull();
    expect(findUpload('clip-3', 'me')).toMatchObject({ assetId: 'a3' });
    localStorage.clear();
  });

  it('a delete does not refetch the deleted asset while a page still shows it', async () => {
    const server = jsonFetch({
      '/api/v1/assets/a1': assetBody({ status: 'ready' }),
      'DELETE /api/v1/assets/a1': { success: true },
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => ({ asset: useAssetById('a1'), del: useDeleteAssets() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.asset.data?.id).toBe('a1'));

    await act(() => result.current.del.mutateAsync(['a1']));
    await new Promise((r) => setTimeout(r, 50));

    const after = server.calls.slice(server.calls.findIndex((c) => c.method === 'DELETE') + 1);
    expect(after.filter((c) => c.path === '/api/v1/assets/a1')).toEqual([]);
  });

  it('stops polling an asset that answers 404', async () => {
    const server = jsonFetch({ '/api/v1/assets/a1': reply(404, { error: 'not found' }) });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper, client } = wrapper();
    client.setQueryData(['assets', 'one', 'a1'], { status: 'processing', createdAt: '' });
    renderHook(() => useAssetById('a1'), { wrapper: Wrapper });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 3_500));
    expect(server.calls).toHaveLength(1);
  });

  it('does not poll a video whose upload stopped more than 10 minutes ago (FLW-12)', async () => {
    const server = jsonFetch({
      '/api/v1/assets/a1': assetBody({
        status: 'created',
        created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      }),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    renderHook(() => useAssetById('a1'), { wrapper: Wrapper });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    // the detail poll runs every 3 s while a video is in flight
    await new Promise((r) => setTimeout(r, 3_500));
    expect(server.calls).toHaveLength(1);
  });

  it('keeps polling an upload that started a minute ago', async () => {
    // the poll's own clock, so a loaded machine that runs timers late cannot
    // make the 3 s interval look like no poll at all
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const server = jsonFetch({
        '/api/v1/assets/a1': assetBody({
          status: 'uploading',
          created_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      });
      vi.stubGlobal('fetch', vi.fn(server));
      const { Wrapper } = wrapper();
      renderHook(() => useAssetById('a1'), { wrapper: Wrapper });
      await waitFor(() => expect(server.calls).toHaveLength(1));
      await act(async () => vi.advanceTimersByTime(3_000));
      await waitFor(() => expect(server.calls).toHaveLength(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling the processing job on a 401', async () => {
    const server = jsonFetch({
      '/api/v1/assets/a1/processing': reply(401, { error: 'Not signed in' }),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    renderHook(() => useProcessingJob('a1', 'processing', true), { wrapper: Wrapper });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 3_500));
    expect(server.calls).toHaveLength(1);
  });

  it('marks the stats stale when a polled asset finishes processing', async () => {
    let status = 'processing';
    const server = jsonFetch({ '/api/v1/assets/a1': () => assetBody({ status }) });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper, client } = wrapper();
    client.setQueryData(['stats'], {});
    const { result } = renderHook(() => useAssetById('a1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe('processing'));
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(false);

    status = 'ready';
    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(true);
  });

  it('marks the stats stale when an asset in a polled list settles', async () => {
    let status = 'processing';
    const server = jsonFetch({
      '/api/v1/assets': () => ({
        data: [assetBody({ status })],
        total: 1,
        page: 1,
        limit: 24,
        next_cursor: null,
      }),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper, client } = wrapper();
    client.setQueryData(['stats'], {});
    const { result } = renderHook(() => useAssetList({ page: 1 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.data[0].status).toBe('processing'));
    // a poll that changes nothing leaves the stats alone
    await act(() => result.current.refetch());
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(false);

    status = 'failed';
    await act(() => result.current.refetch());
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(true);
  });

  it('keeps a row hidden when a list poll lands mid-delete with the row still in it', async () => {
    let releaseDelete!: () => void;
    const deleteHeld = new Promise<void>((r) => (releaseDelete = r));
    let deleted = false;
    const listBody = () => ({
      // the server has not processed the delete yet, so the row is still there
      data: deleted ? [] : [assetBody({ status: 'ready' })],
      total: deleted ? 0 : 1,
      page: 1,
      limit: 24,
      next_cursor: null,
    });
    const server = jsonFetch({
      '/api/v1/assets': listBody,
      'DELETE /api/v1/assets/a1': async () => {
        await deleteHeld;
        deleted = true;
        return { success: true };
      },
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => ({ list: useAssetList({ page: 1 }), del: useDeleteAssets() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(1));

    let deleting!: Promise<unknown>;
    act(() => {
      deleting = result.current.del.mutateAsync(['a1']);
    });
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(0));

    // a poll that started after the optimistic removal answers with the stale row
    const stale = await act(() => result.current.list.refetch());
    expect(stale.data?.data.map((a) => a.id) ?? []).not.toContain('a1');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.list.data?.data).toHaveLength(0);
    expect(result.current.list.data?.total).toBe(0);

    releaseDelete();
    await act(() => deleting);
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));
    expect(result.current.list.data?.data).toHaveLength(0);
  });

  it('also hides the row in lists it does not fetch itself, and shows it again if the delete fails', async () => {
    let releaseDelete!: () => void;
    const deleteHeld = new Promise<void>((r) => (releaseDelete = r));
    const server = jsonFetch({
      '/api/v1/assets': {
        data: [assetBody({ status: 'ready' })],
        total: 1,
        page: 1,
        limit: 6,
        next_cursor: null,
      },
      'DELETE /api/v1/assets/a1': async () => {
        await deleteHeld;
        return reply(409, { error: 'Asset is locked' });
      },
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => ({ latest: useLatestAssets(), del: useDeleteAssets() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.latest.data?.data).toHaveLength(1));

    let deleting!: Promise<unknown>;
    act(() => {
      deleting = result.current.del.mutateAsync(['a1']);
    });
    await waitFor(() => expect(result.current.latest.data?.data).toHaveLength(0));
    await act(() => result.current.latest.refetch());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.latest.data?.data).toHaveLength(0);

    releaseDelete();
    await act(() => deleting);
    await waitFor(() => expect(result.current.latest.data?.data).toHaveLength(1));
  });
});

describe('useDeleteAssets and the session', () => {
  it('ends the session on a 401 instead of reporting a failed row (FLW-13)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(jsonFetch({ 'DELETE /api/v1/assets/a1': reply(401, { error: 'Not signed in' }) })),
    );
    const client = createQueryClient();
    const seen = vi.fn();
    const stop = onUnauthorized(seen);
    const { result } = renderHook(() => useDeleteAssets(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(() => result.current.mutateAsync(['a1']).catch(() => {}));
    expect(seen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isError).toBe(true));
    stop();
  });

  it('turns a failed row into a sentence, not the raw server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({ 'DELETE /api/v1/assets/a1': reply(500, { error: 'Internal Server Error' }) }),
      ),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteAssets(), { wrapper: Wrapper });
    let failures: Awaited<ReturnType<typeof result.current.mutateAsync>> = [];
    await act(async () => {
      failures = await result.current.mutateAsync(['a1']);
    });
    expect(failures).toEqual([
      { id: 'a1', error: expect.stringMatching(/^The server ran into a problem \(error 500\)/) },
    ]);
  });
});

const listPage = (data: unknown[], total: number, hasMore = false) => ({
  data,
  total,
  page: 1,
  limit: 100,
  next_cursor: null,
  has_more: hasMore,
});
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe('useStaleUploadCount', () => {
  it('counts waiting uploads older than 10 minutes, walking past the young ones', async () => {
    const young = Array.from({ length: 100 }, (_, i) =>
      assetBody({ id: `y${i}`, status: 'created', created_at: ago(1) }),
    );
    const server = jsonFetch({
      '/api/v1/assets': ({ query }: { query: URLSearchParams }) =>
        query.get('page') === '1'
          ? listPage(young, 167, true)
          : listPage(
              [
                assetBody({ id: 'y100', status: 'created', created_at: ago(2) }),
                assetBody({ id: 'old', status: 'created', created_at: ago(30) }),
              ],
              167,
              true,
            ),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStaleUploadCount(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe(66));
    expect(server.calls.map((c) => c.query.get('status'))).toEqual(['created', 'created']);
    expect(server.calls.map((c) => c.query.get('order'))).toEqual(['desc', 'desc']);
  });

  it('is zero when every waiting upload is recent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(jsonFetch({ '/api/v1/assets': listPage([assetBody({ status: 'created' })], 1) })),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStaleUploadCount(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe(0));
  });
});

describe('fetchAllMatching', () => {
  it('walks the pages with the same filters and stops at the cap', async () => {
    const server = jsonFetch({
      '/api/v1/assets': ({ query }: { query: URLSearchParams }) => {
        const p = Number(query.get('page'));
        return listPage(
          Array.from({ length: 100 }, (_, i) => assetBody({ id: `p${p}-${i}` })),
          700,
          true,
        );
      },
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const rows = await fetchAllMatching({ status: 'ready', search: 'cat' }, 250);
    expect(rows).toHaveLength(250);
    expect(server.calls).toHaveLength(3);
    expect(server.calls.every((c) => c.query.get('status') === 'ready')).toBe(true);
    expect(server.calls.every((c) => c.query.get('search') === 'cat')).toBe(true);
    expect(server.calls.map((c) => c.query.get('page'))).toEqual(['1', '2', '3']);
  });
});

describe('useSetAccess', () => {
  const a1 = { ...assetBody({ id: 'a1', status: 'ready' }) };
  const a2 = { ...assetBody({ id: 'a2', status: 'ready' }) };

  it('edits each video with its version as If-Match and shows the new access at once', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const server = jsonFetch({
      'PATCH /api/v1/assets/a1': async () => {
        await held;
        return { ...a1, access_tier: 'private' };
      },
      'PATCH /api/v1/assets/a2': async () => {
        await held;
        return { ...a2, access_tier: 'private' };
      },
      '/api/v1/assets': listPage([a1, a2], 2),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const update = vi.spyOn(sluby.assets, 'update');
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => ({ list: useAssetList({ page: 1 }), set: useSetAccess() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
    const assets = result.current.list.data!.data;

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.set.mutateAsync({ assets, accessTier: 'private' });
    });
    await waitFor(() =>
      expect(result.current.list.data?.data.map((a) => a.accessTier)).toEqual([
        'private',
        'private',
      ]),
    );
    release();
    await act(() => done);
    expect(update).toHaveBeenCalledWith('a1', { accessTier: 'private' }, { ifMatch: assets[0] });
    expect(update).toHaveBeenCalledWith('a2', { accessTier: 'private' }, { ifMatch: assets[1] });
    expect(server.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { access_tier: 'private' },
      { access_tier: 'private' },
    ]);
    update.mockRestore();
  });

  it('reports a refused edit and puts that row back', async () => {
    const server = jsonFetch({
      'PATCH /api/v1/assets/a1': { ...a1, access_tier: 'private' },
      'PATCH /api/v1/assets/a2': reply(412, { error: 'This video was changed somewhere else.' }),
      '/api/v1/assets': listPage([a1, a2], 2),
    });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => ({ list: useAssetList({ page: 1 }), set: useSetAccess() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
    let failures: Awaited<ReturnType<typeof result.current.set.mutateAsync>> = [];
    await act(async () => {
      failures = await result.current.set.mutateAsync({
        assets: result.current.list.data!.data,
        accessTier: 'private',
      });
    });
    expect(failures.map((f) => f.id)).toEqual(['a2']);
    expect(failures[0].error).toBeDefined();
  });

  it('ends the session on a 401 instead of listing failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(jsonFetch({ 'PATCH /api/v1/assets/a1': reply(401, { error: 'Not signed in' }) })),
    );
    const client = createQueryClient();
    const seen = vi.fn();
    const stop = onUnauthorized(seen);
    const { result } = renderHook(() => useSetAccess(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const asset = {
      id: 'a1',
      accessTier: 'public',
      updatedAt: '2026-10-01T00:00:00Z',
    } as VideoAsset;
    await act(() =>
      result.current.mutateAsync({ assets: [asset], accessTier: 'private' }).catch(() => {}),
    );
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });
});

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import { jsonFetch, reply } from '@/test/render';
import { useLatestAssets } from './useLatestAssets';
import { useProcessingJob } from './asset-detail-queries';
import {
  isInFlight,
  useAssetById,
  useAssetList,
  useDeleteAssets,
  useUpdateAssetMeta,
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
    expect(isInFlight(at('created', '2026-10-07T11:00:00Z'), now)).toBe(true);
    expect(isInFlight(at('ready', '2026-10-07T11:00:00Z'), now)).toBe(false);
    expect(isInFlight(at('failed', '2026-10-07T11:00:00Z'), now)).toBe(false);
    // older than the upload expiry: the transfer is gone, nothing will change
    expect(isInFlight(at('created', '2026-10-06T11:00:00Z'), now)).toBe(false);
    expect(isInFlight(at('uploading', '2026-10-06T11:00:00Z'), now)).toBe(false);
  });
});

describe('asset hooks', () => {
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

  it('an edit marks every asset list and the stats stale', async () => {
    const server = jsonFetch({ 'PATCH /api/v1/assets/a1': assetBody({ title: 'New' }) });
    vi.stubGlobal('fetch', vi.fn(server));
    const { Wrapper, client } = wrapper();
    for (const key of [['assets', 'latest', 6], ['assets', 'playable', ''], ['stats']]) {
      client.setQueryData(key, {});
    }
    const { result } = renderHook(() => useUpdateAssetMeta(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync({ id: 'a1', data: { title: 'New' } }));

    expect(client.getQueryState(['assets', 'latest', 6])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['assets', 'playable', ''])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(true);
    expect(client.getQueryData<VideoAsset>(['assets', 'one', 'a1'])?.title).toBe('New');
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

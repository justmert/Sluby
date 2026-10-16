import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import { jsonFetch, reply } from '@/test/render';
import { useProcessingJob } from './asset-detail-queries';
import { isInFlight, useAssetById, useDeleteAssets, useUpdateAssetMeta } from './asset-queries';

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
});

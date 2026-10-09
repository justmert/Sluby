import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch } from '@/test/render';
import { useApiKeys, useCreateApiKey } from './useApiKeys';

const key = (id: string) => ({
  id,
  name: id,
  scopes: ['read'],
  rate_limit: 100,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  expires_at: null,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => vi.unstubAllGlobals());

describe('useApiKeys', () => {
  it('follows every page and keeps the limits the first page sends (B-08)', async () => {
    const limits = { max_keys: 20, max_rate_limit: 1000 };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          '/api/v1/keys': ({ query }: { query: URLSearchParams }) =>
            query.get('cursor')
              ? { data: [key('k2')], has_more: false, next_cursor: null, limits }
              : { data: [key('k1')], has_more: true, next_cursor: 'c1', limits },
        }),
      ),
    );
    const { result } = renderHook(() => useApiKeys(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.data.map((k) => k.id)).toEqual(['k1', 'k2']);
    expect(result.current.data!.limits).toEqual(limits);
  });

  it('has no limits from a server before B-08', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({ '/api/v1/keys': { data: [key('k1')], has_more: false, next_cursor: null } }),
      ),
    );
    const { result } = renderHook(() => useApiKeys(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ data: [key('k1')] });
  });

  it('puts a new key in the list only once the server made it (MOT-17)', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let answer!: (v: unknown) => void;
    let listed: Array<Record<string, unknown>> = [key('k1')];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          '/api/v1/keys': () => ({ data: listed, has_more: false, next_cursor: null }),
          'POST /api/v1/keys': () => new Promise((r) => (answer = r)),
        }),
      ),
    );
    const own = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const list = renderHook(() => useApiKeys(), { wrapper: own });
    await waitFor(() => expect(list.result.current.data?.data).toHaveLength(1));
    const create = renderHook(() => useCreateApiKey(), { wrapper: own });
    const done = create.result.current.mutateAsync({ name: 'n', scopes: ['read'], rate_limit: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.getQueryData<{ data: unknown[] }>(['api-keys'])?.data).toHaveLength(1);
    listed = [{ ...key('k2'), prefix: 'sluby_x' }, ...listed];
    answer({ ...key('k2'), key: 'sluby_x', prefix: 'sluby_x' });
    await done;
    const rows = client.getQueryData<{ data: Array<Record<string, unknown>> }>(['api-keys'])!.data;
    expect(rows[0]).toMatchObject({ id: 'k2', prefix: 'sluby_x' });
    expect(JSON.stringify(rows)).not.toContain('"key"');
  });
});

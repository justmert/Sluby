import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, reply } from '@/test/render';
import {
  DELIVERIES_POLL_MS,
  useCreateWebhook,
  useUpdateWebhook,
  useWebhook,
  useWebhooks,
} from './useWebhooks';

const hook = {
  id: 'w1',
  url: 'https://a.example/h',
  events: ['asset.ready'],
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
};

function setup(routes: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchStub = jsonFetch(routes);
  vi.stubGlobal('fetch', vi.fn(fetchStub));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, fetchStub, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

describe('useWebhooks hooks', () => {
  it('shows the listed copy of a webhook while its own request runs (B-07)', async () => {
    let answer!: (v: unknown) => void;
    const { wrapper } = setup({
      '/api/v1/webhooks': { data: [hook] },
      '/api/v1/webhooks/w1': () => new Promise((r) => (answer = r)),
    });
    const list = renderHook(() => useWebhooks(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const one = renderHook(() => useWebhook('w1'), { wrapper });
    expect(one.result.current.data?.url).toBe('https://a.example/h');
    answer({ ...hook, last_delivery_at: null, last_delivery_ok: null });
    await waitFor(() => expect(one.result.current.data?.last_delivery_at).toBeNull());
  });

  it('writes a patched webhook into the list and the single copy (B-03)', async () => {
    let server = hook;
    const { wrapper, client } = setup({
      '/api/v1/webhooks': () => ({ data: [server] }),
      'PATCH /api/v1/webhooks/w1': () => (server = { ...hook, is_active: false }),
    });
    const list = renderHook(() => useWebhooks(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const update = renderHook(() => useUpdateWebhook(), { wrapper });
    await update.result.current.mutateAsync({ id: 'w1', patch: { is_active: false } });
    expect(client.getQueryData<{ data: (typeof hook)[] }>(['webhooks'])?.data[0].is_active).toBe(
      false,
    );
    expect(client.getQueryData<typeof hook>(['webhooks', 'one', 'w1'])?.is_active).toBe(false);
  });

  it('adds a webhook to the list only once the server answered (MOT-17)', async () => {
    const { wrapper, client } = setup({
      '/api/v1/webhooks': { data: [] },
      'POST /api/v1/webhooks': reply(500, { error: 'boom' }),
    });
    const list = renderHook(() => useWebhooks(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const create = renderHook(() => useCreateWebhook(), { wrapper });
    const sent = create.result.current.mutateAsync({
      url: 'https://b.example/h',
      events: ['asset.ready'],
    });
    expect(client.getQueryData<{ data: unknown[] }>(['webhooks'])?.data).toHaveLength(0);
    await expect(sent).rejects.toThrow();
    expect(client.getQueryData<{ data: unknown[] }>(['webhooks'])?.data).toHaveLength(0);
  });

  it('polls deliveries every 10 seconds', () => {
    expect(DELIVERIES_POLL_MS).toBe(10_000);
  });
});

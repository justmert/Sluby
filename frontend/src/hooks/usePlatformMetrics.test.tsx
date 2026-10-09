import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, reply } from '@/test/render';
import { usePlatformMetrics } from './usePlatformMetrics';

function setup(route: unknown) {
  const server = jsonFetch({ '/api/v1/metrics': route });
  vi.stubGlobal('fetch', vi.fn(server));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { server, client, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

const failing = reply(500, { error: 'Internal Server Error' });

describe('usePlatformMetrics', () => {
  it('backs off while the metrics keep failing: 2, 4, 8, then 16 seconds', async () => {
    const { client, wrapper } = setup(failing);
    renderHook(() => usePlatformMetrics(true), { wrapper });
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    const interval = () =>
      (query.observers[0].options.refetchInterval as (q: typeof query) => number | false)(query);

    const seen: (number | false)[] = [];
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(query.state.status).toBe('error'));
      seen.push(interval());
      await act(() => query.fetch().catch(() => {}));
    }
    expect(seen).toEqual([2_000, 4_000, 8_000, 16_000, 16_000]);
  });

  it('keeps the last error while a retry is in flight, so the page does not flicker to skeletons', async () => {
    let answer: ((r: Response) => void) | null = null;
    const { client, wrapper } = setup(() =>
      answer === null
        ? failing
        : new Promise<Response>((r) => {
            answer = r;
          }),
    );
    const { result } = renderHook(() => usePlatformMetrics(true), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // the next attempt hangs: react query drops the error and goes back to pending
    answer = () => {};
    act(() => {
      void client.refetchQueries({ queryKey: ['metrics'] });
    });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.error).not.toBeNull();
    expect(result.current.isError).toBe(true);
  });

  it('polls on the normal clock again after a success', async () => {
    const body = { timestamp: new Date().toISOString(), metrics: [] };
    let fail = true;
    const { client, wrapper } = setup(() => (fail ? failing : body));
    renderHook(() => usePlatformMetrics(true), { wrapper });
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    const interval = () =>
      (query.observers[0].options.refetchInterval as (q: typeof query) => number | false)(query);
    await waitFor(() => expect(query.state.status).toBe('error'));
    await act(() => query.fetch().catch(() => {}));
    expect(interval()).toBe(4_000);
    fail = false;
    await act(() => query.fetch());
    // one sample: still seeding the chart
    expect(interval()).toBe(2_000);
  });
});

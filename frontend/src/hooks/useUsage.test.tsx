import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, reply } from '@/test/render';
import { lastDays, useUsage, USAGE_DAYS } from './useUsage';

function setup(route: unknown) {
  const server = jsonFetch({ '/api/v1/stats/usage': route });
  vi.stubGlobal('fetch', vi.fn(server));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { server, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

const usage = {
  days: Array.from({ length: USAGE_DAYS }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10),
    plays: i < 10 ? 5 : i >= USAGE_DAYS - 2 ? 3 : 0,
  })),
  total: 56,
};

describe('useUsage', () => {
  it('asks for the 90 days the server keeps', async () => {
    const { server, wrapper } = setup(usage);
    const { result } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(usage));
    expect(server.calls[0].query.get('days')).toBe('90');
  });

  it('keeps other failures as errors', async () => {
    const { wrapper } = setup(reply(500, { error: 'Internal Server Error' }));
    const { result } = renderHook(() => useUsage(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('sums the last 30 days', () => {
    const last = lastDays(usage);
    expect(last.days).toHaveLength(30);
    expect(last.total).toBe(6);
  });
});

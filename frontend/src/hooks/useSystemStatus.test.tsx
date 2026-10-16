import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch } from '@/test/render';
import { healthOf, SYSTEM_STATUS_POLL_MS, useSystemStatus } from './useSystemStatus';
import type { SystemStatus } from './useStats';

const status = { status: 'ok', scope: 'account' } as SystemStatus;

function setup() {
  const server = jsonFetch({ '/api/v1/system/status': status });
  vi.stubGlobal('fetch', vi.fn(server));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { server, client, wrapper };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSystemStatus', () => {
  it('shares one request between every caller', async () => {
    const { server, wrapper } = setup();
    const { result } = renderHook(
      () => [useSystemStatus({ poll: true }), useSystemStatus(), useSystemStatus()],
      { wrapper },
    );
    await waitFor(() => expect(result.current[1].data).toEqual(status));
    expect(server.calls).toHaveLength(1);
  });

  it('does not ask again when a polling page mounts right after the shell asked', async () => {
    const { server, wrapper } = setup();
    const shell = renderHook(() => useSystemStatus({ poll: true }), { wrapper });
    await waitFor(() => expect(shell.result.current.data).toEqual(status));
    // the overview or health page opens a moment later with its own poll
    const page = renderHook(() => useSystemStatus({ poll: true }), { wrapper });
    expect(page.result.current.data).toEqual(status);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.calls).toHaveLength(1);
  });

  it('polls every 20 seconds only when asked to', () => {
    const { client, wrapper } = setup();
    renderHook(() => useSystemStatus({ poll: true }), { wrapper });
    const observers = client.getQueryCache().find({ queryKey: ['system-status'] })!.observers;
    expect(observers[0].options.refetchInterval).toBe(SYSTEM_STATUS_POLL_MS);
    expect(SYSTEM_STATUS_POLL_MS).toBe(20_000);
  });

  it('reads once and then from the cache without poll', async () => {
    const { client, server, wrapper } = setup();
    const first = renderHook(() => useSystemStatus(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual(status));
    const query = client.getQueryCache().find({ queryKey: ['system-status'] })!;
    expect(query.observers[0].options.refetchInterval).toBe(false);
    first.unmount();
    // a second page mounting later does not ask again
    const second = renderHook(() => useSystemStatus(), { wrapper });
    expect(second.result.current.data).toEqual(status);
    expect(server.calls).toHaveLength(1);
  });
});

describe('healthOf', () => {
  it('is the server verdict, or unknown before an answer', () => {
    expect(healthOf(undefined)).toBe('unknown');
    expect(healthOf({ ...status, status: 'degraded' })).toBe('degraded');
  });
});

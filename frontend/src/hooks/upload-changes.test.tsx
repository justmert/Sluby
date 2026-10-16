import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fakeUploadClient } from '@/test/fake-uploads';
import { createUploadStore } from '@/lib/upload-store';
import { useUploadChanges } from './asset-queries';

const { fake, store } = vi.hoisted(() => ({
  fake: {} as { client?: ReturnType<typeof fakeUploadClient> },
  store: {} as { current?: ReturnType<typeof createUploadStore> },
}));

vi.mock('@/lib/studio-upload', () => ({
  get uploadStore() {
    return store.current;
  },
}));

describe('useUploadChanges', () => {
  it('marks asset lists and stats stale when an upload creates or finishes an asset', async () => {
    fake.client = fakeUploadClient();
    store.current = createUploadStore(fake.client.client, { unloadTarget: null });
    const client = new QueryClient();
    client.setQueryData(['assets', 'list', {}], { data: [] });
    client.setQueryData(['stats'], {});
    renderHook(() => useUploadChanges(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(false);

    fake.client.processing.mockResolvedValue({ status: 'processing', stage: 'queued', logs: [] });
    await act(async () => {
      store.current!.start(new File(['x'], 'a.mp4', { type: 'video/mp4' }), { title: 'A' });
      fake.client!.current().resolveAsset('a1');
      fake.client!.current().finish();
    });

    expect(client.getQueryState(['assets', 'list', {}])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(true);
  });
});

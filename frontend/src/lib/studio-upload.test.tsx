import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthenticationError } from '@sluby/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/components/AuthGate';
import { fakeUploadClient } from '@/test/fake-uploads';
import { createQueryClient } from './query-client';
import { uploadStore } from './studio-upload';

// tus cannot run in jsdom, so the studio's sdk client is the hand-driven fake;
// the store, the session events and the gate are the real ones
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeUploadClient> | null }));
vi.mock('./sluby', async () => {
  const { fakeUploadClient } = await import('@/test/fake-uploads');
  fake.current = fakeUploadClient();
  return { sluby: fake.current.client };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('studio upload store', () => {
  it('signs the studio out when an upload answers 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/v1/auth/me'
          ? json({
              id: 'u1',
              name: 'Alice',
              username: 'alice',
              provider: 'github',
              provider_label: 'GitHub',
              auth_disabled: false,
              expires_at: '2026-10-14T00:00:00.000Z',
            })
          : json({ error: 'unexpected call' }, 500),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <p>studio</p>
        </AuthGate>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('studio')).toBeInTheDocument();

    uploadStore.start(new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' }), {
      title: 'Clip',
    });
    fake.current!.current().fail(new AuthenticationError('Not signed in'));

    expect(
      await screen.findByText('Your session ended. Sign in again to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.queryByText('studio')).not.toBeInTheDocument();
    expect(uploadStore.getState().uploads[0]).toMatchObject({ authFailed: true });
  });
});

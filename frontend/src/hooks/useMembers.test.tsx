import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, reply } from '@/test/render';
import {
  INVITES_KEY,
  MEMBERS_KEY,
  useChangeRole,
  useCreateInvite,
  useCreateResetLink,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  type Member,
} from './useMembers';

const bea: Member = {
  id: 'm2',
  name: 'Bea',
  role: 'member',
  status: 'active',
  sign_in: [{ provider: 'password', username: 'bea@example.com' }],
  created_at: '2026-10-01T00:00:00.000Z',
  last_sign_in_at: null,
};

const invite = {
  id: 'i1',
  role: 'member',
  created_at: '2026-10-18T00:00:00.000Z',
  expires_at: '2026-10-25T00:00:00.000Z',
  created_by: { id: 'u1', name: 'Alice' },
};

function setup(routes: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchStub = jsonFetch(routes);
  vi.stubGlobal('fetch', fetchStub);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, fetchStub, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

describe('useMembers hooks', () => {
  it('lists members and pending invites', async () => {
    const { wrapper } = setup({
      '/api/v1/members': { data: [bea] },
      '/api/v1/invites': { data: [invite] },
    });
    const members = renderHook(() => useMembers(), { wrapper });
    const invites = renderHook(() => useInvites(), { wrapper });
    await waitFor(() => expect(members.result.current.data).toEqual([bea]));
    await waitFor(() => expect(invites.result.current.data).toEqual([invite]));
  });

  it('writes a changed role into the list as the server answered it', async () => {
    let server = bea;
    const { wrapper, client, fetchStub } = setup({
      '/api/v1/members': () => ({ data: [server] }),
      'PATCH /api/v1/members/m2': () => (server = { ...bea, role: 'admin' }),
    });
    const list = renderHook(() => useMembers(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const change = renderHook(() => useChangeRole(), { wrapper });
    await act(() => change.result.current.mutateAsync({ id: 'm2', role: 'admin' }));
    expect(client.getQueryData<Member[]>(MEMBERS_KEY)?.[0].role).toBe('admin');
    expect(fetchStub.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'admin' });
  });

  it('keeps the list as it was when the server refuses, with its reason', async () => {
    const { wrapper, client } = setup({
      '/api/v1/members': { data: [{ ...bea, role: 'admin' }] },
      'POST /api/v1/members/m2/remove': reply(409, {
        error: 'This is the last admin who can sign in. Make someone else an admin first.',
        reason: 'last_admin',
      }),
    });
    const list = renderHook(() => useMembers(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const remove = renderHook(() => useRemoveMember(), { wrapper });
    await act(() => remove.result.current.mutateAsync('m2').catch(() => {}));
    expect(client.getQueryData<Member[]>(MEMBERS_KEY)?.[0].status).toBe('active');
  });

  it('does not keep a reset link or an invite link in the cache', async () => {
    const { wrapper, client } = setup({
      'POST /api/v1/members/m2/reset-link': reply(201, {
        url: 'https://s.example/studio/reset/t',
        expires_at: '2026-10-26T00:00:00.000Z',
      }),
      'POST /api/v1/invites': reply(201, {
        id: 'i2',
        url: 'https://s.example/studio/join/t',
        role: 'admin',
        expires_at: '2026-10-26T00:00:00.000Z',
      }),
      '/api/v1/invites': { data: [] },
    });
    const reset = renderHook(() => useCreateResetLink(), { wrapper });
    const made = await act(() => reset.result.current.mutateAsync('m2'));
    expect(made.url).toBe('https://s.example/studio/reset/t');
    const create = renderHook(() => useCreateInvite(), { wrapper });
    await act(() =>
      create.result.current.mutateAsync({ role: 'admin', maxUses: 1, expiresInDays: 7 }),
    );
    act(() => {
      reset.result.current.reset();
      create.result.current.reset();
    });
    await waitFor(() =>
      expect(
        JSON.stringify(
          client
            .getMutationCache()
            .getAll()
            .map((m) => m.state),
        ),
      ).not.toMatch(/studio\/(reset|join)/),
    );
  });

  it('drops a revoked invite from the list', async () => {
    let rows = [invite];
    const { wrapper, client } = setup({
      '/api/v1/invites': () => ({ data: rows }),
      'DELETE /api/v1/invites/i1': () => {
        rows = [];
        return { success: true };
      },
    });
    const list = renderHook(() => useInvites(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    const revoke = renderHook(() => useRevokeInvite(), { wrapper });
    await act(() => revoke.result.current.mutateAsync('i1'));
    expect(client.getQueryData(INVITES_KEY)).toEqual([]);
  });
});

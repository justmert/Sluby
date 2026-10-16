import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { replacePage } from '@/lib/navigation';
import type { AuthSession } from '@/lib/session';
import { WithSession } from '@/test/session';
import { UserMenu } from './UserMenu';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), replacePage: vi.fn() }));

let client: QueryClient;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderMenu(props: Partial<AuthSession> = {}) {
  client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <WithSession {...props}>
          <UserMenu />
        </WithSession>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(replacePage).mockClear());
afterEach(() => vi.unstubAllGlobals());

async function signOut() {
  await userEvent.click(screen.getByRole('button', { name: /alice/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
}

describe('UserMenu', () => {
  it('signs out and reloads the studio, not the bare root', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderMenu();
    await signOut();
    await vi.waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/logout');
  });

  it('stays signed in and says so when the logout call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: 'Internal Server Error' }, 500)),
    );
    renderMenu();
    await signOut();
    expect(
      await screen.findByText(
        'Could not sign out. The server ran into a problem (error 500). Try again in a moment. If it keeps happening, check the server logs.',
      ),
    ).toBeInTheDocument();
    expect(replacePage).not.toHaveBeenCalled();
  });

  it('marks an operator and has no sign out when sign-in is off', async () => {
    renderMenu({ operator: true, authDisabled: true, provider: 'local', username: 'dev' });
    await userEvent.click(screen.getByRole('button', { name: /dev, operator/ }));
    expect(await screen.findByText('Sign-in is off on this server')).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('clears the cache before leaving, and replaces the entry so Back cannot return (FLW-07)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    renderMenu();
    client.setQueryData(['keys'], [{ id: 'k1', name: 'production' }]);
    let cachedAtNavigation: unknown = 'not called';
    vi.mocked(replacePage).mockImplementation(() => {
      cachedAtNavigation = client.getQueryData(['keys']);
    });
    await signOut();
    await vi.waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(cachedAtNavigation).toBeUndefined();
  });

  it('treats a 401 from sign out as signed out, not as a failure (FLW-13)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Not signed in' }, 401)));
    renderMenu();
    await signOut();
    await vi.waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(screen.queryByText(/Could not sign out/)).not.toBeInTheDocument();
  });

  it('shows sign-in off on its trigger and keeps the theme (D-15, A11Y-39)', async () => {
    renderMenu({ operator: true, authDisabled: true, provider: 'local', username: 'dev' });
    const trigger = screen.getByRole('button', { name: 'dev, operator, sign-in off' });
    expect(trigger).toHaveTextContent('Sign-in off');
    await userEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Theme' })).toBeInTheDocument();
  });

  it('links to the API reference and the source, each in a new tab (D-13)', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /alice/ }));
    const reference = await screen.findByRole('menuitem', { name: 'API reference' });
    expect(reference).toHaveAttribute('href', '/api/v1/docs');
    expect(reference).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('menuitem', { name: 'Source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/justmert/Sluby',
    );
  });

  it('drops its chevron and side padding on a very narrow bar (A11Y-46)', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: /alice/ });
    expect(trigger).toHaveClass('max-[24rem]:px-1.5');
    expect(trigger.querySelector('.lucide-chevron-down')).toHaveClass('max-[24rem]:hidden');
  });
});

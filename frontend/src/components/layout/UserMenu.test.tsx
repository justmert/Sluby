import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { loadPage } from '@/lib/navigation';
import type { AuthSession } from '@/lib/session';
import { WithSession } from '@/test/session';
import { UserMenu } from './UserMenu';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn() }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderMenu(props: Partial<AuthSession> = {}) {
  render(
    <ThemeProvider>
      <WithSession {...props}>
        <UserMenu />
      </WithSession>
      <Toaster />
    </ThemeProvider>,
  );
}

beforeEach(() => vi.mocked(loadPage).mockClear());
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
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledWith('/studio'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/logout');
  });

  it('stays signed in and says so when the logout call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Internal Server Error' }, 500)));
    renderMenu();
    await signOut();
    expect(await screen.findByText('Could not sign out: Internal Server Error')).toBeInTheDocument();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('marks an operator and has no sign out when sign-in is off', async () => {
    renderMenu({ operator: true, authDisabled: true, provider: 'local', username: 'dev' });
    await userEvent.click(screen.getByRole('button', { name: /dev, operator/ }));
    expect(await screen.findByText('Sign-in is off (local dev account)')).toBeInTheDocument();
    expect(screen.getByText('Operator: sees deployment status and metrics')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
  });
});

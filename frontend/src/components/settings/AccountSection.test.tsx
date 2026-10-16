import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replacePage } from '@/lib/navigation';
import type { AuthSession } from '@/lib/session';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import { AccountSection } from './AccountSection';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), replacePage: vi.fn() }));

beforeEach(() => vi.mocked(replacePage).mockClear());
afterEach(() => vi.unstubAllGlobals());

function setup(session: Partial<AuthSession> = {}, routes: Record<string, unknown> = {}) {
  const fetch = jsonFetch(routes);
  vi.stubGlobal('fetch', fetch);
  return renderPage(
    <WithSession {...session}>
      <AccountSection />
    </WithSession>,
  );
}

const valueOf = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('AccountSection', () => {
  it('names the account, how it signed in and an operator role with what it means (CPY-23)', () => {
    setup({ operator: true });
    // the section is already called Account; the row names what it shows
    expect(screen.queryByText('Account', { selector: 'dt' })).not.toBeInTheDocument();
    expect(valueOf('Username')).toHaveTextContent('alice');
    expect(valueOf('Signed in with')).toHaveTextContent('GitHub');
    expect(valueOf('Role')).toHaveTextContent('OperatorCan see server status, storage and metrics');
  });

  it('calls a non-operator a member', () => {
    setup();
    expect(valueOf('Role')).toHaveTextContent(/^Member$/);
  });

  it('says sign-in is off, and offers no sign out then', () => {
    setup({ authDisabled: true, username: 'dev', provider: 'local', operator: true });
    expect(valueOf('Sign-in')).toHaveTextContent(
      'Sign-in is off on this serverAnyone who can open this address has operator access.',
    );
    expect(screen.queryByText('Signed in with')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('signs out by clearing the cache and replacing the page', async () => {
    const { client } = setup({}, { 'POST /api/v1/auth/logout': { success: true } });
    client.setQueryData(['keys'], [{ id: 'k1' }]);
    let cached: unknown = 'not called';
    vi.mocked(replacePage).mockImplementation(() => {
      cached = client.getQueryData(['keys']);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(cached).toBeUndefined();
  });

  it('treats a 401 as signed out (FLW-13)', async () => {
    setup({}, { 'POST /api/v1/auth/logout': reply(401, { error: 'Not signed in' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
  });

  it('stays and says why when sign out fails', async () => {
    setup({}, { 'POST /api/v1/auth/logout': reply(500, { error: 'Internal Server Error' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByText(/^Could not sign out\. The server ran into a problem/),
    ).toBeInTheDocument();
    expect(replacePage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});

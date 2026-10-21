import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRefreshContext, type AuthSession } from '@/lib/session';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AccountSection } from './AccountSection';

afterEach(() => vi.unstubAllGlobals());

function setup(
  session: Partial<AuthSession> = {},
  routes: Record<string, unknown> = {},
  refresh: () => Promise<void> = async () => {},
) {
  const fetch = jsonFetch(routes);
  vi.stubGlobal('fetch', fetch);
  renderPage(
    <SessionRefreshContext.Provider value={refresh}>
      <WithSession {...session}>
        <AccountSection />
      </WithSession>
    </SessionRefreshContext.Provider>,
  );
  return fetch;
}

const card = () => screen.getByRole('region', { name: 'Account' }).lastElementChild as HTMLElement;

describe('AccountSection', () => {
  it('shows the avatar initials, the name, the handle with its provider and an admin chip (CPY-23)', () => {
    const fetch = setup({ name: 'Mert Köklü', username: 'justmert', admin: true });
    expect(screen.getByText('From your GitHub sign-in.')).toBeInTheDocument();
    expect(card()).toHaveTextContent('MKMert Köklü@justmert on GitHubAdminEdit name');
    const chip = screen.getByText('Admin');
    expect(chip).toHaveAttribute('data-variant', 'progress');
    // what the role means, for whoever wonders
    expect(chip).toHaveAttribute(
      'title',
      'Manages members and sees server status, storage and metrics',
    );
    // the initials are decoration; the name next to them is read
    expect(screen.getByText('MK')).toHaveAttribute('aria-hidden', 'true');
    // it needs nothing from the server
    expect(fetch.calls).toHaveLength(0);
  });

  it('calls a non-admin a member', () => {
    setup();
    expect(card()).toHaveTextContent('ALAlice@alice on GitHubMember');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows the email of a password sign-in without an @', () => {
    setup({
      name: 'Alice',
      username: 'alice@example.com',
      provider: 'password',
      providerLabel: 'Password',
    });
    expect(screen.getByText('Signed in with your password.')).toBeInTheDocument();
    expect(card()).toHaveTextContent('ALAlicealice@example.comMember');
    expect(card()).not.toHaveTextContent('@alice@');
  });

  it('takes two letters from a one-word name', () => {
    setup({ name: 'dev' });
    expect(card()).toHaveTextContent(/^DEdev/);
  });

  it('says sign-in is off, and what that means', () => {
    setup({
      authDisabled: true,
      name: 'Local',
      username: 'dev',
      provider: 'local',
      admin: true,
    });
    expect(screen.getByText('Sign-in is off on this server.')).toBeInTheDocument();
    expect(card()).toHaveTextContent('Anyone who can open this address has admin access.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('AccountSection name', () => {
  it('changes the member name and reads the session again', async () => {
    const refresh = vi.fn(async () => {});
    const fetch = setup(
      { name: 'Alice' },
      { 'PATCH /api/v1/auth/me': { name: 'Alice Liddell' } },
      refresh,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change your name' });
    const field = within(dialog).getByLabelText('Name');
    expect(field).toHaveValue('Alice');
    await userEvent.clear(field);
    await userEvent.type(field, '  Alice Liddell ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Alice Liddell' });
  });

  it('asks for a name before saving', async () => {
    const fetch = setup({ name: 'Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change your name' });
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(within(dialog).getByText('Enter your name.')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('offers no rename with sign-in off', () => {
    setup({ authDisabled: true });
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
  });
});

import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@/lib/session';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AccountSection } from './AccountSection';

afterEach(() => vi.unstubAllGlobals());

function setup(session: Partial<AuthSession> = {}) {
  const fetch = jsonFetch({});
  vi.stubGlobal('fetch', fetch);
  renderPage(
    <WithSession {...session}>
      <AccountSection />
    </WithSession>,
  );
  return fetch;
}

const card = () => screen.getByRole('region', { name: 'Account' }).lastElementChild as HTMLElement;

describe('AccountSection', () => {
  it('shows the avatar initials, the name, the handle with its provider and an admin chip (CPY-23)', () => {
    const fetch = setup({ name: 'Mert Köklü', username: 'justmert', admin: true });
    expect(screen.getByText('From your GitHub sign-in.')).toBeInTheDocument();
    expect(card()).toHaveTextContent('MKMert Köklü@justmert on GitHubAdmin');
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

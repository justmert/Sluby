import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@/lib/session';
import { loadPage } from '@/lib/navigation';
import { toastSuccess } from '@/lib/toast';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import { SignInMethodsSection } from './SignInMethodsSection';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn() }));
vi.mock('@/lib/toast', async (original) => ({
  ...(await original<typeof import('@/lib/toast')>()),
  toastSuccess: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(loadPage).mockClear();
  vi.mocked(toastSuccess).mockClear();
});

const config = (github: boolean) => ({
  auth_disabled: false,
  setup_required: false,
  methods: { password: true, github },
});

const PASSWORD = { provider: 'password', username: 'alice@example.com' };
const GITHUB = { provider: 'github', username: 'alice' };

function setup(
  session: Partial<AuthSession> = {},
  routes: Record<string, unknown> = {},
  github = true,
) {
  const fetch = jsonFetch({ '/api/v1/auth/config': config(github), ...routes });
  vi.stubGlobal('fetch', fetch);
  const view = renderPage(
    <WithSession signIn={[PASSWORD]} {...session}>
      <SignInMethodsSection />
    </WithSession>,
  );
  return { fetch, ...view };
}

const section = () => screen.getByRole('region', { name: 'Sign-in methods' });

async function fillAndSave(current: string, next: string, confirm = next) {
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  const dialog = await screen.findByRole('dialog', { name: 'Change password' });
  await userEvent.type(within(dialog).getByLabelText('Current password'), current);
  await userEvent.type(within(dialog).getByLabelText('New password'), next);
  await userEvent.type(within(dialog).getByLabelText('Confirm new password'), confirm);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  return dialog;
}

describe('SignInMethodsSection', () => {
  it('shows the password email and a GitHub account that is linked', async () => {
    setup({ signIn: [PASSWORD, GITHUB] });
    expect(within(section()).getByText('alice@example.com')).toBeInTheDocument();
    expect(await within(section()).findByText('@alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link GitHub' })).not.toBeInTheDocument();
  });

  it('offers to link GitHub, and goes there with the link intent', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Link GitHub' }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ link: '1', next: '/studio/settings' })}`,
    );
    expect(screen.getByRole('button', { name: 'Redirecting to GitHub…' })).toBeDisabled();
  });

  it('has no GitHub row when the server has no GitHub sign-in', async () => {
    const { fetch } = setup({}, {}, false);
    await waitFor(() =>
      expect(fetch.calls.some((c) => c.path === '/api/v1/auth/config')).toBe(true),
    );
    // let the answer land
    await screen.findByText('alice@example.com');
    await waitFor(() => expect(within(section()).queryByText('GitHub')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Link GitHub' })).not.toBeInTheDocument();
  });

  it('says how to get a password when the account has none', async () => {
    setup({ signIn: [GITHUB] });
    expect(
      within(section()).getByText('Ask an admin for a reset link to add a password.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
    expect(await within(section()).findByText('@alice')).toBeInTheDocument();
  });

  it('says so when the sign-in settings could not be read', async () => {
    setup({}, { '/api/v1/auth/config': reply(500, { error: 'boom' }) });
    expect(await screen.findByText('Could not check the ways to sign in')).toBeInTheDocument();
  });

  it('changes the password and says how many browsers were signed out', async () => {
    const { fetch } = setup(
      {},
      { 'POST /api/v1/auth/password/change': { success: true, revoked: 2 } },
    );
    await fillAndSave('old password', 'a new password');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Change password' })).not.toBeInTheDocument(),
    );
    expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
      current_password: 'old password',
      new_password: 'a new password',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Password changed. Signed out 2 other browsers.');
  });

  it('says just changed when no other browser was signed in', async () => {
    setup({}, { 'POST /api/v1/auth/password/change': { success: true, revoked: 0 } });
    await fillAndSave('old password', 'a new password');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Password changed.'));
  });

  it('checks the new password and the confirmation before sending', async () => {
    const { fetch } = setup();
    const dialog = await fillAndSave('old password', 'short', 'shorter');
    expect(within(dialog).getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(within(dialog).getByText('The passwords do not match.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('New password')).toHaveFocus();
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('puts a wrong current password under its field', async () => {
    const message = 'Your current password is wrong.';
    setup(
      {},
      {
        'POST /api/v1/auth/password/change': reply(403, {
          error: message,
          reason: 'bad_credentials',
          details: [{ field: 'current_password', message }],
        }),
      },
    );
    const dialog = await fillAndSave('not it at all', 'a new password');
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Current password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByLabelText('Current password')).toHaveFocus();
  });

  it('counts the wait for too many attempts in minutes', async () => {
    setup(
      {},
      {
        'POST /api/v1/auth/password/change': () =>
          new Response(JSON.stringify({ error: 'Too many attempts.', retry_after: 120 }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '120' },
          }),
      },
    );
    const dialog = await fillAndSave('old password', 'a new password');
    expect(
      await within(dialog).findByText('Too many attempts. Try again in 2 minutes.'),
    ).toBeInTheDocument();
  });

  it('gives the password boxes the right autocomplete', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    expect(within(dialog).getByLabelText('Current password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(within(dialog).getByLabelText('New password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });
});

describe('SignInMethodsSection account changes', () => {
  it('changes the sign-in email with the current password', async () => {
    const { fetch } = setup(
      { provider: 'password', signIn: [PASSWORD] },
      { 'POST /api/v1/auth/email/change': { email: 'alice@new.example' } },
    );
    await userEvent.click(within(section()).getByRole('button', { name: 'Change email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change email' });
    expect(dialog).toHaveTextContent('You sign in with alice@example.com now.');
    await userEvent.type(within(dialog).getByLabelText('New email'), 'Alice@New.example');
    await userEvent.type(
      within(dialog).getByLabelText('Current password'),
      'correct horse battery',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change email' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Email changed. Sign in with the new one from now on.',
      ),
    );
    expect(fetch.calls.find((c) => c.path === '/api/v1/auth/email/change')?.body).toEqual({
      email: 'Alice@New.example',
      current_password: 'correct horse battery',
    });
  });

  it('shows a wrong password under its field and keeps the dialog open', async () => {
    setup(
      { provider: 'password', signIn: [PASSWORD] },
      {
        'POST /api/v1/auth/email/change': reply(403, {
          error: 'Your current password is wrong.',
          reason: 'bad_credentials',
          details: [{ field: 'current_password', message: 'Your current password is wrong.' }],
        }),
      },
    );
    await userEvent.click(within(section()).getByRole('button', { name: 'Change email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change email' });
    await userEvent.type(within(dialog).getByLabelText('New email'), 'alice@new.example');
    await userEvent.type(within(dialog).getByLabelText('Current password'), 'wrong password!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change email' }));
    expect(await within(dialog).findByText('Your current password is wrong.')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('refuses the email the account already has before asking the server', async () => {
    const { fetch } = setup({ provider: 'password', signIn: [PASSWORD] });
    await userEvent.click(within(section()).getByRole('button', { name: 'Change email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change email' });
    await userEvent.type(within(dialog).getByLabelText('New email'), 'ALICE@example.com');
    await userEvent.type(within(dialog).getByLabelText('Current password'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change email' }));
    expect(within(dialog).getByText('This is already your email.')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path === '/api/v1/auth/email/change')).toBe(false);
  });

  it('removes GitHub after asking, when the password signed this browser in', async () => {
    const { fetch } = setup(
      { provider: 'password', signIn: [PASSWORD, GITHUB] },
      { 'DELETE /api/v1/auth/identities/github': { success: true } },
    );
    await userEvent.click(await within(section()).findByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove GitHub?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('GitHub removed.'));
    expect(fetch.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('keeps GitHub when this browser signed in with it, or when it is the only way in', async () => {
    const first = setup({ provider: 'github', signIn: [PASSWORD, GITHUB] });
    expect(
      await within(section()).findByText(
        'You signed in with it in this browser. Sign in with your password to remove it.',
      ),
    ).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Remove' })).toBeNull();
    first.unmount();

    setup({ provider: 'github', signIn: [GITHUB] });
    expect(
      await within(section()).findByText('Your only way to sign in, so it stays.'),
    ).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

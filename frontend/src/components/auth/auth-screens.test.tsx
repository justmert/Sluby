import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { domMax } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/components/AuthGate';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { loadPage } from '@/lib/navigation';
import { createQueryClient } from '@/lib/query-client';
import { useSession } from '@/lib/session';
import { jsonFetch, reply } from '@/test/render';
import { linkFromPath } from './link';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), reloadPage: vi.fn() }));

const me = {
  id: 'u1',
  name: 'Alice',
  username: 'alice@example.com',
  provider: 'password',
  provider_label: 'Password',
  auth_disabled: false,
  role: 'member',
  sign_in: [{ provider: 'password', username: 'alice@example.com' }],
  expires_at: '2026-10-14T00:00:00.000Z',
};

const config = {
  auth_disabled: false,
  setup_required: false,
  methods: { password: true, github: true },
};

const ME = '/api/v1/auth/me';
const TOKEN = 'abcDEF123_-xyz';

/**
 * The gate with /auth/me answering 401 until `signIn()` is called, as the
 * session cookie would.
 */
function stub(routes: Record<string, unknown>) {
  let signedIn = false;
  const fetchStub = jsonFetch({
    '/api/v1/auth/config': config,
    '/health': { status: 'ok', version: '0.2.0' },
    [ME]: () => (signedIn ? me : reply(401, { error: 'Not signed in', reason: 'missing' })),
    ...routes,
  });
  vi.stubGlobal('fetch', fetchStub);
  return Object.assign(fetchStub, { signIn: () => (signedIn = true) });
}

function Who() {
  const s = useSession();
  return <p>signed in as {s.name}</p>;
}

function renderGate() {
  render(
    <MotionProvider features={domMax}>
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <Who />
        </AuthGate>
      </QueryClientProvider>
    </MotionProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(loadPage).mockClear();
  window.history.replaceState(null, '', '/');
});

describe('linkFromPath', () => {
  it('reads join and reset links and nothing else', () => {
    expect(linkFromPath('/studio/join/abc_-9')).toEqual({ kind: 'join', token: 'abc_-9' });
    expect(linkFromPath('/studio/reset/abc/')).toEqual({ kind: 'reset', token: 'abc' });
    expect(linkFromPath('/studio/join/')).toBeNull();
    expect(linkFromPath('/studio/join/a/b')).toBeNull();
    expect(linkFromPath('/studio/videos')).toBeNull();
  });
});

describe('password sign-in', () => {
  it('signs in with the email and password, then shows the studio', async () => {
    const f = stub({
      'POST /api/v1/auth/password': () => {
        f.signIn();
        return { success: true };
      },
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), ' alice@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('signed in as Alice')).toBeInTheDocument();
    expect(f.calls.find((c) => c.path === '/api/v1/auth/password')?.body).toEqual({
      email: 'alice@example.com',
      password: 'correct horse',
    });
  });

  it('keeps the page the browser was on', async () => {
    window.history.replaceState(null, '', '/studio/videos?view=grid');
    const f = stub({
      'POST /api/v1/auth/password': () => {
        f.signIn();
        return { success: true };
      },
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('signed in as Alice');
    expect(window.location.pathname + window.location.search).toBe('/studio/videos?view=grid');
  });

  it('asks for both fields before sending anything', async () => {
    const f = stub({});
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says a wrong email or password plainly and keeps what was typed', async () => {
    stub({
      'POST /api/v1/auth/password': reply(401, {
        error: 'Wrong email or password',
        reason: 'bad_credentials',
      }),
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong one!!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('alice@example.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    // a wrong password is not a session that ended
    expect(screen.queryByText(/session ended/i)).not.toBeInTheDocument();
  });

  it('says a removed account was removed', async () => {
    stub({
      'POST /api/v1/auth/password': reply(403, {
        error: 'This account was removed from this workspace',
        reason: 'disabled',
      }),
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), 'bob@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(
        'This account was removed from this workspace. Ask an admin to restore it.',
      ),
    ).toBeInTheDocument();
  });

  it('counts the wait for too many attempts in minutes', async () => {
    stub({
      'POST /api/v1/auth/password': () =>
        new Response(JSON.stringify({ error: 'Too many attempts.', retry_after: 540 }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '540' },
        }),
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Too many attempts. Try again in 9 minutes.'),
    ).toBeInTheDocument();
  });

  it('says so when the browser did not keep the session', async () => {
    stub({ 'POST /api/v1/auth/password': { success: true } });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/did not keep the session/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('shows and hides the password with a pressed toggle', async () => {
    stub({});
    renderGate();
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'password');
  });
});

describe('first admin setup', () => {
  const needsSetup = { '/api/v1/auth/config': { ...config, setup_required: true } };

  // a server with no admin opens on setup, since nobody can sign in there yet
  async function openSetup() {
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Set up Sluby Studio' }),
    ).toBeInTheDocument();
  }

  async function fill() {
    await userEvent.type(screen.getByLabelText('Setup code'), 'ABCDE-FGHJK');
    await userEvent.type(screen.getByLabelText('Your name'), 'Mert');
    await userEvent.type(screen.getByLabelText('Email'), 'mert@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw');
  }

  it('opens on setup, and keeps the sign-in form a click away', async () => {
    stub(needsSetup);
    renderGate();
    await openSetup();
    expect(screen.getByText('docker compose logs backend | grep "setup code"')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(await screen.findByText('This server has no admin yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up the first admin' }));
    await openSetup();
  });

  it('does not offer setup once an admin exists', async () => {
    stub({});
    renderGate();
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText('This server has no admin yet.')).not.toBeInTheDocument();
  });

  it('creates the first admin with the code from the log and signs in', async () => {
    const f = stub({
      ...needsSetup,
      'POST /api/v1/auth/setup': () => {
        f.signIn();
        return reply(201, { success: true });
      },
    });
    renderGate();
    await openSetup();
    expect(screen.getByText(/The server prints it in its log/)).toBeInTheDocument();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
    expect(await screen.findByText('signed in as Alice')).toBeInTheDocument();
    expect(f.calls.find((c) => c.path === '/api/v1/auth/setup')?.body).toEqual({
      code: 'ABCDE-FGHJK',
      name: 'Mert',
      email: 'mert@example.com',
      password: 'long enough pw',
    });
  });

  it('holds a short password back before sending', async () => {
    const f = stub(needsSetup);
    renderGate();
    await openSetup();
    await userEvent.type(screen.getByLabelText('Setup code'), 'ABCDE-FGHJK');
    await userEvent.type(screen.getByLabelText('Your name'), 'Mert');
    await userEvent.type(screen.getByLabelText('Email'), 'mert@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(f.calls.some((c) => c.path === '/api/v1/auth/setup')).toBe(false);
  });

  it('puts a wrong code under the code field', async () => {
    const message = 'That setup code is wrong. Copy it from the server log.';
    stub({
      ...needsSetup,
      'POST /api/v1/auth/setup': reply(403, {
        error: message,
        reason: 'bad_code',
        details: [{ field: 'code', message }],
      }),
    });
    renderGate();
    await openSetup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('Setup code')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Setup code')).toHaveFocus();
  });

  it('sends someone who lost the race back to sign in', async () => {
    let setUp = false;
    stub({
      '/api/v1/auth/config': () => ({ ...config, setup_required: !setUp }),
      'POST /api/v1/auth/setup': () => {
        setUp = true;
        return reply(409, {
          error: 'This server already has an admin. Sign in instead.',
          reason: 'already_set_up',
        });
      },
    });
    renderGate();
    await openSetup();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
    expect(
      await screen.findByText('This server already has an admin. Sign in instead.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to Sluby Studio' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('This server has no admin yet.')).not.toBeInTheDocument(),
    );
  });

  it('goes back to sign in', async () => {
    stub(needsSetup);
    renderGate();
    await openSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('invite links', () => {
  const invite = {
    kind: 'invite',
    role: 'admin',
    expires_at: '2026-10-26T12:00:00.000Z',
    github: true,
  };

  it('renders without a session, says the role and joins with a password', async () => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    const f = stub({
      [`/api/v1/auth/invites/${TOKEN}`]: invite,
      [`POST /api/v1/auth/invites/${TOKEN}/accept`]: () => {
        f.signIn();
        return reply(201, { success: true });
      },
    });
    renderGate();
    expect(await screen.findByText('You are invited to join as an admin.')).toBeInTheDocument();
    expect(screen.getByText('This invite works until Oct 26, 2026.')).toBeInTheDocument();
    // a link page asks nobody who is signed in
    expect(f.calls.some((c) => c.path === ME)).toBe(false);
    await userEvent.type(screen.getByLabelText('Your name'), 'Bea');
    await userEvent.type(screen.getByLabelText('Email'), 'bea@example.com');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(screen.getByLabelText('Password'), 'a good password');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('signed in as Alice')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/studio');
    expect(f.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Bea',
      email: 'bea@example.com',
      password: 'a good password',
    });
  });

  it('joins with github through the invite', async () => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    stub({ [`/api/v1/auth/invites/${TOKEN}`]: { ...invite, role: 'member' } });
    renderGate();
    expect(await screen.findByText('You are invited to join as a member.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continue with github/i }));
    expect(loadPage).toHaveBeenCalledWith(
      `/api/v1/auth/github/login?${new URLSearchParams({ invite: TOKEN, next: '/studio' })}`,
    );
  });

  it('leaves github out when the server has not set it up', async () => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    stub({ [`/api/v1/auth/invites/${TOKEN}`]: { ...invite, github: false } });
    renderGate();
    await screen.findByRole('button', { name: 'Join' });
    expect(screen.queryByRole('button', { name: /continue with github/i })).not.toBeInTheDocument();
  });

  it('puts a taken email under the email field', async () => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    const message = 'Another account already signs in with this email.';
    stub({
      [`/api/v1/auth/invites/${TOKEN}`]: invite,
      [`POST /api/v1/auth/invites/${TOKEN}/accept`]: reply(409, {
        error: message,
        reason: 'email_taken',
        details: [{ field: 'email', message }],
      }),
    });
    renderGate();
    await userEvent.type(await screen.findByLabelText('Your name'), 'Bea');
    await userEvent.type(screen.getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a good password');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it.each([
    [reply(404, { error: 'This link does not exist.' }), 'This link does not exist.'],
    [reply(410, { error: 'x', reason: 'used' }), 'This link was already used.'],
    [reply(410, { error: 'x', reason: 'expired' }), 'This link has expired.'],
    [reply(410, { error: 'x', reason: 'revoked' }), 'This link was withdrawn.'],
  ])('explains a link that does not work, with a way to sign in', async (answer, text) => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    stub({ [`/api/v1/auth/invites/${TOKEN}`]: answer });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${text} Ask an admin for a new one.`,
    );
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/studio');
  });

  it('offers to try again when the server did not answer', async () => {
    window.history.replaceState(null, '', `/studio/join/${TOKEN}`);
    let calls = 0;
    stub({
      [`/api/v1/auth/invites/${TOKEN}`]: () =>
        ++calls === 1 ? reply(503, { error: 'down' }) : invite,
    });
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Join' })).toBeInTheDocument();
  });
});

describe('reset links', () => {
  const reset = {
    kind: 'reset',
    email: 'alice@example.com',
    expires_at: '2026-10-26T12:00:00.000Z',
    github: false,
  };

  it('sets a new password for the named email and signs in', async () => {
    window.history.replaceState(null, '', `/studio/reset/${TOKEN}`);
    const f = stub({
      [`/api/v1/auth/invites/${TOKEN}`]: reset,
      [`POST /api/v1/auth/invites/${TOKEN}/accept`]: () => {
        f.signIn();
        return { success: true };
      },
    });
    renderGate();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Set a new password' }),
    ).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New password'), 'a new password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a new password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('signed in as Alice')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/studio');
    expect(f.calls.find((c) => c.method === 'POST')?.body).toEqual({
      password: 'a new password',
    });
  });

  it('wants the two passwords to match', async () => {
    window.history.replaceState(null, '', `/studio/reset/${TOKEN}`);
    const f = stub({ [`/api/v1/auth/invites/${TOKEN}`]: reset });
    renderGate();
    await userEvent.type(await screen.findByLabelText('New password'), 'a new password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a new passwrod');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus();
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('asks for an email when the account has no password yet', async () => {
    window.history.replaceState(null, '', `/studio/reset/${TOKEN}`);
    const f = stub({
      [`/api/v1/auth/invites/${TOKEN}`]: { ...reset, email: null },
      [`POST /api/v1/auth/invites/${TOKEN}/accept`]: () => {
        f.signIn();
        return { success: true };
      },
    });
    renderGate();
    expect(
      await screen.findByText('Choose the email and password you will sign in with.'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'bea@example.com');
    await userEvent.type(screen.getByLabelText('New password'), 'a new password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a new password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await screen.findByText('signed in as Alice');
    expect(f.calls.find((c) => c.method === 'POST')?.body).toEqual({
      password: 'a new password',
      email: 'bea@example.com',
    });
  });

  it('says a removed account cannot use its reset link', async () => {
    window.history.replaceState(null, '', `/studio/reset/${TOKEN}`);
    stub({
      [`/api/v1/auth/invites/${TOKEN}`]: reply(403, {
        error: 'This account was removed from this workspace',
        reason: 'disabled',
      }),
    });
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account was removed from this workspace. Ask an admin to restore it.',
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { env } from '../config/env.js';
import { createAuthRoutes, safeRedirectPath } from '../api/routes/auth.js';
import { signSession, verifySession, SESSION_COOKIE_NAME } from '../api/auth/session.js';
import { createTestApp } from './helpers/express-helpers.js';
import { memoryAccounts } from './helpers/accounts.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));

const SECRET = 'a-test-session-secret-that-is-long-enough-0123456789';

// github is the external boundary: stand it up as a fake that answers the two
// endpoints the callback calls and records what it was sent
interface GithubFake {
  tokenRequests: Array<Record<string, string>>;
  tokenSignals: AbortSignal[];
  userRequests: Array<{ authorization: string | null; signal: boolean }>;
  tokenReply: { status: number; body: Record<string, unknown> };
  userReply: { status: number; body: Record<string, unknown> };
}

function installGithubFake(): GithubFake {
  const fake: GithubFake = {
    tokenRequests: [],
    tokenSignals: [],
    userRequests: [],
    tokenReply: { status: 200, body: { access_token: 'gho_token', token_type: 'bearer' } },
    userReply: { status: 200, body: { login: 'Octocat', id: 1, avatar_url: '', name: null } },
  };
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      fake.tokenRequests.push(JSON.parse(String(init?.body)));
      if (init?.signal) fake.tokenSignals.push(init.signal);
      return Response.json(fake.tokenReply.body, { status: fake.tokenReply.status });
    }
    if (url === 'https://api.github.com/user') {
      fake.userRequests.push({
        authorization: new Headers(init?.headers).get('authorization'),
        signal: init?.signal instanceof AbortSignal,
      });
      return Response.json(fake.userReply.body, { status: fake.userReply.status });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return fake;
}

const saved = { ...env };
let github: GithubFake;
let accounts: ReturnType<typeof memoryAccounts>;

beforeEach(() => {
  env.GITHUB_CLIENT_ID = 'client-123';
  env.GITHUB_CLIENT_SECRET = 'secret-456';
  env.GITHUB_ALLOWED_USERS = '';
  env.OPERATOR_USERS = '';
  env.PUBLIC_URL = 'http://localhost:3000';
  env.SESSION_SECRET = SECRET;
  env.AUTH_DISABLED = false;
  github = installGithubFake();
  accounts = memoryAccounts();
});

afterEach(() => {
  Object.assign(env, saved);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function app() {
  return createTestApp(createAuthRoutes(accounts.authDeps), '/api/v1/auth');
}

/** A stored session for a github account and its signed cookie header. */
async function signedIn(username = 'octocat', subject = '1', ttlSec = 3600, secret = SECRET) {
  let identity = accounts.identities.find((i) => i.provider === 'github' && i.subject === subject);
  identity ??= accounts.addAccount('github', subject, username);
  accounts.pin('github', username.toLowerCase(), subject);
  const { id } = await accounts.authDeps.createSession({
    userId: identity.userId,
    identityId: identity.id,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
    userAgent: 'test-agent',
  });
  const token = signSession(id, identity.userId, secret, ttlSec);
  return {
    id,
    userId: identity.userId,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
  };
}

function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [String(raw)];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const c = cookies.find((s) => s.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(';')[0]) : undefined;
}

/** The landing path a handshake cookie carries. */
function handshakeNext(cookies: string[]): string {
  const value = cookieValue(cookies, 'sluby_signin')!;
  return Buffer.from(value.split('.')[3], 'base64url').toString('utf8');
}

/** Start a sign-in and return the state github would echo back and the browser's cookie. */
async function startLogin(next?: string): Promise<{ state: string; cookie: string }> {
  const res = await request(app())
    .get('/api/v1/auth/github/login')
    .query(next === undefined ? {} : { next });
  const state = new URL(res.headers.location).searchParams.get('state')!;
  const cookie = setCookies(res).find((c) => c.startsWith('sluby_signin='))!;
  return { state, cookie: cookie.split(';')[0] };
}

/** Run a whole sign-in in one browser. */
async function signInThroughGithub(next?: string) {
  const { state, cookie } = await startLogin(next);
  return request(app())
    .get('/api/v1/auth/github/callback')
    .query({ code: 'the-code', state })
    .set('Cookie', cookie);
}

describe('GET /auth/github/login', () => {
  it('redirects to the github consent page with the client id, callback, scope and a state', async () => {
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('client-123');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/v1/auth/github/callback',
    );
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('binds the state to this browser in a short-lived cookie scoped to the auth routes', async () => {
    const res = await request(app()).get('/api/v1/auth/github/login');
    const state = new URL(res.headers.location).searchParams.get('state')!;
    const cookie = setCookies(res).find((c) => c.startsWith('sluby_signin='))!;
    const [pair, ...attrs] = cookie.split('; ');
    expect(attrs).toEqual(['Path=/api/v1/auth', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600']);
    expect(pair.split('.')[0]).toBe('sluby_signin=github');
    expect(pair.split('.')[2]).toBe(state);
  });

  it('issues a different state on every login', async () => {
    const a = await startLogin();
    const b = await startLogin();
    expect(a.state).not.toBe(b.state);
  });

  it('builds the callback from a public url with a trailing slash', async () => {
    env.PUBLIC_URL = 'https://video.example.com/';
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(new URL(res.headers.location).searchParams.get('redirect_uri')).toBe(
      'https://video.example.com/api/v1/auth/github/callback',
    );
  });

  it('remembers where to land, /studio by default', async () => {
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(handshakeNext(setCookies(res))).toBe('/studio');
  });

  it('keeps a relative next path', async () => {
    const res = await request(app())
      .get('/api/v1/auth/github/login')
      .query({ next: '/studio/assets/abc?tab=renditions' });
    expect(handshakeNext(setCookies(res))).toBe('/studio/assets/abc?tab=renditions');
  });

  it.each([
    '//evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'studio',
    '/\\evil.example',
    '/\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/.//evil.example',
    '/./\\evil.example',
    '\\/evil.example',
  ])('refuses the open redirect %j and falls back to /studio', async (next) => {
    const res = await request(app()).get('/api/v1/auth/github/login').query({ next });
    expect(handshakeNext(setCookies(res))).toBe('/studio');
  });

  it('marks the cookie Secure behind https', async () => {
    env.PUBLIC_URL = 'https://video.example.com';
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(setCookies(res)[0]).toMatch(/; Secure$/);
  });

  it('answers 500 when github oauth is not configured', async () => {
    env.GITHUB_CLIENT_ID = undefined;
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'GitHub sign-in is not configured' });
    expect(res.headers.location).toBeUndefined();
  });

  it('falls through to the 404 for an unknown provider', async () => {
    const res = await request(app()).get('/api/v1/auth/nope/login');
    expect(res.status).toBe(404);
  });
});

describe('safeRedirectPath', () => {
  it.each([
    ['/studio', '/studio'],
    ['/studio/assets/x?y=1#z', '/studio/assets/x?y=1#z'],
    // stays on this origin as a literal path, never a host
    ['/%5Cevil.example', '/%5Cevil.example'],
    ['/a/../studio', '/studio'],
    ['/\\evil.example', '/studio'],
    ['//evil.example', '/studio'],
    ['/.//evil.example', '/studio'],
    [undefined, '/studio'],
    [['/a', '/b'], '/studio'],
  ])('%j -> %j', (raw, expected) => {
    expect(safeRedirectPath(raw)).toBe(expected);
  });
});

describe('GET /auth/github/callback', () => {
  it('exchanges the code, signs the account in and redirects to next', async () => {
    const res = await signInThroughGithub('/studio/settings');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/studio/settings');
    expect(github.tokenRequests).toEqual([
      {
        client_id: 'client-123',
        client_secret: 'secret-456',
        code: 'the-code',
        redirect_uri: 'http://localhost:3000/api/v1/auth/github/callback',
      },
    ]);
    // both github calls carry a timeout signal, so a hung github cannot hold the callback
    expect(github.userRequests).toEqual([{ authorization: 'Bearer gho_token', signal: true }]);
    expect(github.tokenSignals).toHaveLength(1);

    // the account is keyed on github's numeric id, the login is display only
    expect(accounts.identities).toEqual([
      expect.objectContaining({ provider: 'github', subject: '1', username: 'Octocat' }),
    ]);
    const userId = accounts.identities[0].userId;

    const cookies = setCookies(res);
    const payload = verifySession(cookieValue(cookies, SESSION_COOKIE_NAME), SECRET);
    expect(payload?.uid).toBe(userId);
    expect(accounts.sessions).toHaveLength(1);
    expect(accounts.sessions[0]).toMatchObject({ id: payload?.sid, userId, revokedAt: null });
    const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!;
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain(`Max-Age=${7 * 24 * 3600}`);
    expect(sessionCookie).not.toContain('Secure');
    // the handshake cookie is cleared
    expect(cookies).toContain(
      'sluby_signin=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });

  it('claims the legacy github:<login> data on the first sign-in of an id, and only once', async () => {
    await signInThroughGithub();
    const first = accounts.identities[0].userId;
    expect(accounts.claims.get('github:octocat')).toBe(first);

    // a different account now holding the login (the first one renamed)
    github.userReply = { status: 200, body: { login: 'octocat', id: 99 } };
    await signInThroughGithub();
    expect(accounts.identities).toHaveLength(2);
    expect(accounts.claims.get('github:octocat')).toBe(first);
  });

  it('lands on /studio by default', async () => {
    const res = await signInThroughGithub();
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/studio');
  });

  it('marks both cookies Secure behind https', async () => {
    env.PUBLIC_URL = 'https://video.example.com';
    const res = await signInThroughGithub();
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/; Secure$/);
  });

  it('refuses a state presented by a browser that did not start the sign-in (login csrf)', async () => {
    const { state } = await startLogin();
    // the attacker's callback url, opened in a victim browser with no cookie
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'attacker-code', state });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(github.tokenRequests).toHaveLength(0);
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("refuses another sign-in's state even with a handshake cookie", async () => {
    const attacker = await startLogin();
    const victim = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'attacker-code', state: attacker.state })
      .set('Cookie', victim.cookie);
    expect(res.status).toBe(400);
    expect(github.tokenRequests).toHaveLength(0);
  });

  it('refuses a handshake for another provider', async () => {
    const { state, cookie } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state })
      .set('Cookie', cookie.replace('sluby_signin=github.', 'sluby_signin=other.'));
    expect(res.status).toBe(400);
  });

  it('rejects a state it never issued without calling github', async () => {
    const { cookie } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state: 'forged-state' })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(github.tokenRequests).toHaveLength(0);
    expect(setCookies(res)).toEqual([
      'sluby_signin=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
  });

  it('rejects a handshake older than ten minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { state, cookie } = await startLogin();

    vi.setSystemTime(new Date('2026-01-01T00:10:01Z'));
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('still accepts a handshake right at the ten minute mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { state, cookie } = await startLogin();

    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state })
      .set('Cookie', cookie);
    expect(res.status).toBe(302);
  });

  it('answers 400 without a state', async () => {
    const { cookie } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'x' })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('answers 400 without a code', async () => {
    const { state, cookie } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ state })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.text).toBe('GitHub did not send a sign-in code.');
    expect(github.tokenRequests).toHaveLength(0);
  });

  it.each([
    ['with a valid handshake', true],
    ['without a handshake', false],
  ])('never reflects the error parameter into the page (%s)', async (_label, withHandshake) => {
    const { state, cookie } = await startLogin();
    const payload = '<script>alert(document.domain)</script>';
    let req = request(app()).get('/api/v1/auth/github/callback').query({ error: payload, state });
    if (withHandshake) req = req.set('Cookie', cookie);
    const res = await req;
    expect(res.status).toBe(withHandshake ? 500 : 400);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).not.toContain('<script>');
    expect(res.text).not.toContain('alert');
    expect(github.tokenRequests).toHaveLength(0);
  });

  it('says the sign-in was cancelled when github reports access_denied', async () => {
    const { state, cookie } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ error: 'access_denied', state })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.text).toBe('GitHub sign-in was cancelled.');
  });

  it('answers 500 when github oauth is not configured', async () => {
    env.GITHUB_CLIENT_SECRET = undefined;
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state: 's' });
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub sign-in is not configured.');
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('fails without a session when github rejects the code', async () => {
    github.tokenReply = { status: 200, body: { error: 'bad_verification_code' } };
    const res = await signInThroughGithub();
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub sign-in failed. Please try again.');
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
    expect(github.userRequests).toHaveLength(0);
  });

  it('fails without a session when the token endpoint errors', async () => {
    github.tokenReply = { status: 502, body: {} };
    const res = await signInThroughGithub();
    expect(res.status).toBe(500);
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('fails without a session when the github user lookup fails', async () => {
    github.userReply = { status: 401, body: { message: 'Bad credentials' } };
    const res = await signInThroughGithub();
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub sign-in failed. Please try again.');
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('fails without a session when github sends no numeric id', async () => {
    github.userReply = { status: 200, body: { login: 'octocat', id: '1' } };
    const res = await signInThroughGithub();
    expect(res.status).toBe(500);
    expect(accounts.identities).toEqual([]);
  });

  describe('with an allowlist', () => {
    beforeEach(() => {
      env.GITHUB_ALLOWED_USERS = ' alice , OctoCat ,';
    });

    it('lets a listed login in, case-insensitively, and pins the entry to its id', async () => {
      const res = await signInThroughGithub();
      expect(res.status).toBe(302);
      expect(accounts.pins.get('github\noctocat')).toBe('1');
    });

    it('turns away anyone else with 403 and no account', async () => {
      github.userReply = { status: 200, body: { login: 'mallory', id: 2 } };
      const res = await signInThroughGithub();
      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.text).toContain('"mallory" is not on the Studio allowlist');
      expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
      expect(accounts.identities).toEqual([]);
      expect(accounts.claims.size).toBe(0);
    });

    it('turns away a new owner of a pinned login (a recycled github name)', async () => {
      await signInThroughGithub();
      github.userReply = { status: 200, body: { login: 'octocat', id: 99 } };
      const res = await signInThroughGithub();
      expect(res.status).toBe(403);
      expect(accounts.identities.map((i) => i.subject)).toEqual(['1']);
    });

    it('keeps letting the pinned account in after it renames', async () => {
      await signInThroughGithub();
      github.userReply = { status: 200, body: { login: 'octocat-renamed', id: 1 } };
      const res = await signInThroughGithub();
      expect(res.status).toBe(302);
      expect(accounts.identities[0].username).toBe('octocat-renamed');
    });

    it('admits an id entry whatever the login', async () => {
      env.GITHUB_ALLOWED_USERS = 'id:42';
      github.userReply = { status: 200, body: { login: 'anyone', id: 42 } };
      expect((await signInThroughGithub()).status).toBe(302);
    });

    it('opens sign-up with *', async () => {
      env.GITHUB_ALLOWED_USERS = '*';
      github.userReply = { status: 200, body: { login: 'anyone', id: 42 } };
      expect((await signInThroughGithub()).status).toBe(302);
    });
  });

  describe('with operator handles', () => {
    it('pins an operator login at sign-in even when sign-up is open', async () => {
      env.GITHUB_ALLOWED_USERS = '*';
      env.OPERATOR_USERS = 'github:OctoCat';
      expect((await signInThroughGithub()).status).toBe(302);
      expect(accounts.pins.get('github\noctocat')).toBe('1');
    });

    it('never makes the next owner of a pinned operator login an operator', async () => {
      env.OPERATOR_USERS = 'github:octocat';
      await signInThroughGithub();
      github.userReply = { status: 200, body: { login: 'octocat', id: 99 } };
      const res = await signInThroughGithub();
      expect(res.status).toBe(302);
      expect(accounts.pins.get('github\noctocat')).toBe('1');
      const cookie = `${SESSION_COOKIE_NAME}=${cookieValue(setCookies(res), SESSION_COOKIE_NAME)}`;
      const me = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.body.username).toBe('octocat');
      expect(me.body.operator).toBe(false);
    });

    it('does not pin anything for an account the sign-in allowlist refuses', async () => {
      env.GITHUB_ALLOWED_USERS = 'alice';
      env.OPERATOR_USERS = 'github:octocat';
      expect((await signInThroughGithub()).status).toBe(403);
      expect(accounts.pins.size).toBe(0);
    });
  });
});

describe('GET /auth/me', () => {
  it('answers 401 without a session cookie', async () => {
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not signed in', reason: 'missing' });
  });

  it('returns the account, the identity it signed in with and the expiry', async () => {
    const { cookie, userId } = await signedIn();
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', `other=1; ${cookie}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: userId,
      name: 'octocat',
      username: 'octocat',
      provider: 'github',
      provider_label: 'GitHub',
      auth_disabled: false,
      operator: false,
      providerLabel: 'GitHub',
    });
    expect(Date.parse(res.body.expires_at)).toBeGreaterThan(Date.now() + 3500_000);
    // the old unix-seconds field stays one more release
    expect(res.body.expiresAt).toBe(Math.floor(Date.parse(res.body.expires_at) / 1000));
  });

  it('answers 401 for a session signed with another secret', async () => {
    const { cookie } = await signedIn('octocat', '1', 3600, 'some-other-secret');
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing');
  });

  it('answers 401 for an expired session', async () => {
    const { cookie } = await signedIn('octocat', '1', -1);
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not signed in', reason: 'expired' });
  });

  it('says expired when the stored session ran out before its cookie', async () => {
    const { id, cookie } = await signedIn();
    accounts.sessions.find((x) => x.id === id)!.expiresAt = new Date(Date.now() - 1000);
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('expired');
  });

  it('answers 401 for a session whose payload was edited', async () => {
    const { id, cookie } = await signedIn();
    const other = accounts.addAccount('github', '2', 'admin');
    const sig = decodeURIComponent(cookie.split('=')[1]).split('.')[1];
    const forged = Buffer.from(
      JSON.stringify({ sid: id, uid: other.userId, exp: 9999999999 }),
    ).toString('base64url');
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${forged}.${sig}`);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing');
  });

  it('answers 401 for a cookie from before accounts (login payload)', async () => {
    const { id } = await signedIn();
    const crypto = await import('node:crypto');
    const encoded = Buffer.from(
      JSON.stringify({ sid: id, login: 'octocat', exp: 9999999999 }),
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${encoded}.${sig}`);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing');
  });

  it('reports the local dev account when auth is disabled', async () => {
    env.AUTH_DISABLED = true;
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: accounts.identities[0].userId,
      name: 'Local developer',
      username: 'dev',
      provider: 'local',
      provider_label: 'Local',
      auth_disabled: true,
      operator: true,
      expires_at: null,
      providerLabel: 'Local',
      authDisabled: true,
    });
    expect(accounts.identities[0]).toMatchObject({ provider: 'local', subject: 'dev' });
  });
});

describe('GET /auth/me operator', () => {
  it('reports an operator listed by id, and stops on the next request once unlisted', async () => {
    const { cookie } = await signedIn('octocat', '7');
    const me = () => request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    env.OPERATOR_USERS = 'github:id:7';
    expect((await me()).body.operator).toBe(true);
    env.OPERATOR_USERS = 'github:id:8';
    const after = await me();
    expect(after.status).toBe(200);
    expect(after.body.operator).toBe(false);
  });

  it('reports an operator listed by a login pinned to the account, through a rename', async () => {
    const { cookie } = await signedIn('octocat', '7');
    env.OPERATOR_USERS = 'github:OCTOCAT';
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).body.operator).toBe(
      true,
    );
    accounts.identities[0].username = 'octocat-renamed';
    const renamed = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(renamed.body.username).toBe('octocat-renamed');
    expect(renamed.body.operator).toBe(true);
  });

  it('does not take a login entry by the current login alone, without the pin', async () => {
    const { cookie } = await signedIn('octocat', '7');
    accounts.pins.clear();
    env.OPERATOR_USERS = 'github:octocat';
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).body.operator).toBe(
      false,
    );
  });

  it('ignores entries of another provider', async () => {
    const { cookie } = await signedIn('octocat', '7');
    env.OPERATOR_USERS = 'gitlab:id:7,gitlab:octocat';
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).body.operator).toBe(
      false,
    );
  });
});

describe('server-side session state', () => {
  it('answers 401 once the stored session was revoked, even with a valid cookie', async () => {
    const { id, userId, cookie } = await signedIn();
    await accounts.authDeps.revokeSession(id, userId);
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not signed in', reason: 'revoked' });
  });

  it('ends existing sessions of an account taken off the allowlist', async () => {
    env.GITHUB_ALLOWED_USERS = 'octocat';
    const { cookie } = await signedIn('octocat');
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
    env.GITHUB_ALLOWED_USERS = 'alice';
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('not_allowed');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the stored session, not just the cookie', async () => {
    const { id, cookie } = await signedIn();
    const res = await request(app()).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(accounts.sessions.find((r) => r.id === id)?.revokedAt).toBeInstanceOf(Date);
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('clears the session cookie', async () => {
    const res = await request(app()).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(setCookies(res)).toEqual([
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
  });

  it('clears it with Secure behind https', async () => {
    env.PUBLIC_URL = 'https://video.example.com';
    const res = await request(app()).post('/api/v1/auth/logout');
    expect(setCookies(res)[0]).toMatch(/Max-Age=0; Secure$/);
  });
});

describe('/auth/sessions', () => {
  it('lists the live sessions of the signed-in account, marking the current one', async () => {
    const other = await signedIn('octocat');
    const me = await signedIn('octocat');
    await signedIn('alice', '2');
    const res = await request(app()).get('/api/v1/auth/sessions').set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string; current: boolean }) => [s.id, s.current])).toEqual([
      [me.id, true],
      [other.id, false],
    ]);
    expect(res.body.data[0]).toMatchObject({ user_agent: 'test-agent' });
    expect(Date.parse(res.body.data[0].expires_at)).toBeGreaterThan(Date.now());
  });

  it('needs a session: an anonymous caller gets 401', async () => {
    const res = await request(app()).get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Not signed in');
  });

  it('ends another session of the same account, which then stops working', async () => {
    const laptop = await signedIn('octocat');
    const phone = await signedIn('octocat');
    const res = await request(app())
      .delete(`/api/v1/auth/sessions/${phone.id}`)
      .set('Cookie', laptop.cookie);
    expect(res.status).toBe(200);
    expect(setCookies(res)).toEqual([]);
    const ended = await request(app()).get('/api/v1/auth/me').set('Cookie', phone.cookie);
    expect(ended.status).toBe(401);
    // what the phone's studio shows: signed out from another browser
    expect(ended.body.reason).toBe('revoked');
    const listed = await request(app()).get('/api/v1/auth/sessions').set('Cookie', phone.cookie);
    expect(listed.body).toEqual({ error: 'Not signed in', reason: 'revoked' });
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', laptop.cookie)).status).toBe(
      200,
    );
  });

  it("will not end someone else's session", async () => {
    const mine = await signedIn('octocat');
    const theirs = await signedIn('alice', '2');
    const res = await request(app())
      .delete(`/api/v1/auth/sessions/${theirs.id}`)
      .set('Cookie', mine.cookie);
    expect(res.status).toBe(404);
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', theirs.cookie)).status).toBe(
      200,
    );
  });

  it('clears the cookie when the current session is ended', async () => {
    const me = await signedIn('octocat');
    const res = await request(app())
      .delete(`/api/v1/auth/sessions/${me.id}`)
      .set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(setCookies(res)[0]).toMatch(/Max-Age=0/);
  });

  it('signs out everywhere', async () => {
    const a = await signedIn('octocat');
    const b = await signedIn('octocat');
    const alice = await signedIn('alice', '2');
    const res = await request(app()).delete('/api/v1/auth/sessions').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, revoked: 2 });
    for (const s of [a, b]) {
      expect((await request(app()).get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(
        401,
      );
    }
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', alice.cookie)).status).toBe(
      200,
    );
  });

  it('says there are no sessions when sign-in is disabled', async () => {
    env.AUTH_DISABLED = true;
    const res = await request(app()).get('/api/v1/auth/sessions');
    expect(res.status).toBe(409);
  });
});

describe('unknown auth routes', () => {
  it('fall through to the json 404', async () => {
    const res = await request(app()).get('/api/v1/auth/github/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route GET /api/v1/auth/github/nope not found');
  });
});

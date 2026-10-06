import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { env } from '../config/env.js';
import { createAuthRoutes, type AuthRouteDeps } from '../api/routes/auth.js';
import { signSession, verifySession, SESSION_COOKIE_NAME } from '../api/auth/session.js';
import { createTestApp } from './helpers/express-helpers.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));

const SECRET = 'a-test-session-secret-that-is-long-enough-0123456789';

// github is the external boundary: stand it up as a fake that answers the two
// endpoints the callback calls and records what it was sent
interface GithubFake {
  tokenRequests: Array<Record<string, string>>;
  userRequests: Array<{ authorization: string | null }>;
  tokenReply: { status: number; body: Record<string, unknown> };
  userReply: { status: number; body: Record<string, unknown> };
}

function installGithubFake(): GithubFake {
  const fake: GithubFake = {
    tokenRequests: [],
    userRequests: [],
    tokenReply: { status: 200, body: { access_token: 'gho_token', token_type: 'bearer' } },
    userReply: { status: 200, body: { login: 'Octocat', id: 1, avatar_url: '', name: null } },
  };
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      fake.tokenRequests.push(JSON.parse(String(init?.body)));
      return Response.json(fake.tokenReply.body, { status: fake.tokenReply.status });
    }
    if (url === 'https://api.github.com/user') {
      fake.userRequests.push({
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Response.json(fake.userReply.body, { status: fake.userReply.status });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return fake;
}

// the session table is postgres in production (its queries have their own
// postgres-backed tests); here an in-memory store with the same contract
interface StoredSession {
  id: string;
  login: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

function memoryStore() {
  const rows: StoredSession[] = [];
  let seq = 0;
  const live = (r: StoredSession) => !r.revokedAt && r.expiresAt > new Date();
  const deps: AuthRouteDeps = {
    createSession: async ({ login, expiresAt, userAgent }) => {
      const row = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        login,
        userAgent,
        createdAt: new Date(Date.now() + seq),
        expiresAt,
        revokedAt: null,
      };
      rows.push(row);
      return { id: row.id };
    },
    findActiveSession: async (id) => {
      const r = rows.find((x) => x.id === id && live(x));
      return r && { id: r.id, login: r.login, expiresAt: r.expiresAt };
    },
    listActiveSessions: async (login) =>
      rows
        .filter((r) => r.login === login && live(r))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    revokeSession: async (id, login) => {
      const r = rows.find((x) => x.id === id && x.login === login && !x.revokedAt);
      if (!r) return false;
      r.revokedAt = new Date();
      return true;
    },
    revokeAllSessions: async (login) => {
      const mine = rows.filter((r) => r.login === login && !r.revokedAt);
      for (const r of mine) r.revokedAt = new Date();
      return mine.length;
    },
    pruneSessions: async () => {},
  };
  return { rows, deps };
}

const saved = { ...env };
let github: GithubFake;
let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  env.GITHUB_CLIENT_ID = 'client-123';
  env.GITHUB_CLIENT_SECRET = 'secret-456';
  env.GITHUB_ALLOWED_USERS = '';
  env.PUBLIC_URL = 'http://localhost:3000';
  env.SESSION_SECRET = SECRET;
  env.AUTH_DISABLED = false;
  github = installGithubFake();
  store = memoryStore();
});

afterEach(() => {
  Object.assign(env, saved);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function app() {
  return createTestApp(createAuthRoutes(store.deps), '/api/v1/auth');
}

/** A stored session for `login` and its signed cookie header. */
async function signedIn(login = 'octocat', ttlSec = 3600, secret = SECRET) {
  const { id } = await store.deps.createSession({
    login,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
    userAgent: 'test-agent',
  });
  const token = signSession(id, login, secret, ttlSec);
  return { id, cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` };
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

/** Start a login and return the state github would echo back. */
async function startLogin(next?: string): Promise<{ state: string; nextCookie: string }> {
  const res = await request(app())
    .get('/api/v1/auth/github/login')
    .query(next === undefined ? {} : { next });
  const state = new URL(res.headers.location).searchParams.get('state')!;
  const nextCookie = setCookies(res).find((c) => c.startsWith('sluby_login_next='))!;
  return { state, nextCookie: nextCookie.split(';')[0] };
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

  it('remembers where to land after login in a short-lived cookie, /studio by default', async () => {
    const res = await request(app()).get('/api/v1/auth/github/login');
    const cookie = setCookies(res).find((c) => c.startsWith('sluby_login_next='))!;
    expect(cookie.split('; ')).toEqual([
      'sluby_login_next=%2Fstudio',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=600',
    ]);
  });

  it('keeps a relative next path', async () => {
    const res = await request(app())
      .get('/api/v1/auth/github/login')
      .query({ next: '/studio/assets/abc?tab=renditions' });
    expect(cookieValue(setCookies(res), 'sluby_login_next')).toBe(
      '/studio/assets/abc?tab=renditions',
    );
  });

  it.each(['//evil.example', 'https://evil.example/', 'javascript:alert(1)', 'studio'])(
    'refuses the open redirect %s and falls back to /studio',
    async (next) => {
      const res = await request(app()).get('/api/v1/auth/github/login').query({ next });
      expect(cookieValue(setCookies(res), 'sluby_login_next')).toBe('/studio');
    },
  );

  it('marks the cookie Secure behind https', async () => {
    env.PUBLIC_URL = 'https://video.example.com';
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(setCookies(res)[0]).toMatch(/; Secure$/);
  });

  it('answers 500 when github oauth is not configured', async () => {
    env.GITHUB_CLIENT_ID = undefined;
    const res = await request(app()).get('/api/v1/auth/github/login');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'GitHub OAuth is not configured' });
    expect(res.headers.location).toBeUndefined();
  });
});

describe('GET /auth/github/callback', () => {
  it('exchanges the code, signs a session for the github user and redirects to next', async () => {
    const { state, nextCookie } = await startLogin('/studio/settings');

    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'the-code', state })
      .set('Cookie', nextCookie);

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
    expect(github.userRequests).toEqual([{ authorization: 'Bearer gho_token' }]);

    const cookies = setCookies(res);
    const session = cookieValue(cookies, SESSION_COOKIE_NAME)!;
    const payload = verifySession(session, SECRET);
    expect(payload?.login).toBe('Octocat');
    // the cookie stands for a stored, live session row
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ id: payload?.sid, login: 'Octocat', revokedAt: null });
    const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!;
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain(`Max-Age=${7 * 24 * 3600}`);
    expect(sessionCookie).not.toContain('Secure');
    // the one-shot next cookie is cleared
    expect(cookies).toContain('sluby_login_next=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });

  it('lands on /studio without a next cookie', async () => {
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/studio');
  });

  it('ignores a tampered next cookie that points off-site', async () => {
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state })
      .set('Cookie', 'sluby_login_next=%2F%2Fevil.example');
    expect(res.headers.location).toBe('/studio');
  });

  it('marks both cookies Secure behind https', async () => {
    env.PUBLIC_URL = 'https://video.example.com';
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/; Secure$/);
  });

  it('accepts a state only once', async () => {
    const { state } = await startLogin();
    const first = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(first.status).toBe(302);

    const replay = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(replay.status).toBe(400);
    expect(replay.text).toBe('Invalid or expired state');
    expect(github.tokenRequests).toHaveLength(1);
  });

  it('rejects a state it never issued without calling github', async () => {
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state: 'forged-state' });
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid or expired state');
    expect(github.tokenRequests).toHaveLength(0);
    expect(setCookies(res)).toEqual([]);
  });

  it('rejects a state older than ten minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { state } = await startLogin();

    vi.setSystemTime(new Date('2026-01-01T00:10:00.001Z'));
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid or expired state');
  });

  it('still accepts a state right at the ten minute mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { state } = await startLogin();

    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(302);
  });

  it.each([
    [{ state: 'x' }, 'code'],
    [{ code: 'x' }, 'state'],
    [{}, 'both'],
  ])('answers 400 when %j is missing %s', async (query, _missing) => {
    const res = await request(app()).get('/api/v1/auth/github/callback').query(query);
    expect(res.status).toBe(400);
    expect(res.text).toBe('Missing code or state');
  });

  it('reports the error github redirected back with', async () => {
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ error: 'access_denied', state });
    expect(res.status).toBe(400);
    expect(res.text).toBe('GitHub login failed: access_denied');
    expect(github.tokenRequests).toHaveLength(0);
  });

  it('answers 500 when github oauth is not configured', async () => {
    env.GITHUB_CLIENT_SECRET = undefined;
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state: 's' });
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub OAuth is not configured');
  });

  it('fails without a session when github rejects the code', async () => {
    github.tokenReply = { status: 200, body: { error: 'bad_verification_code' } };
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub login failed. Please try again.');
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
    expect(github.userRequests).toHaveLength(0);
  });

  it('fails without a session when the token endpoint errors', async () => {
    github.tokenReply = { status: 502, body: {} };
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(500);
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('fails without a session when the github user lookup fails', async () => {
    github.userReply = { status: 401, body: { message: 'Bad credentials' } };
    const { state } = await startLogin();
    const res = await request(app())
      .get('/api/v1/auth/github/callback')
      .query({ code: 'c', state });
    expect(res.status).toBe(500);
    expect(res.text).toBe('GitHub login failed. Please try again.');
    expect(cookieValue(setCookies(res), SESSION_COOKIE_NAME)).toBeUndefined();
  });

  describe('with an allowlist', () => {
    beforeEach(() => {
      env.GITHUB_ALLOWED_USERS = ' alice , OctoCat ,';
    });

    it('lets a listed user in, matching the login case-insensitively', async () => {
      const { state } = await startLogin();
      const res = await request(app())
        .get('/api/v1/auth/github/callback')
        .query({ code: 'c', state });
      expect(res.status).toBe(302);
      expect(verifySession(cookieValue(setCookies(res), SESSION_COOKIE_NAME), SECRET)?.login).toBe(
        'Octocat',
      );
    });

    it('turns away anyone else with 403 and no session', async () => {
      github.userReply = { status: 200, body: { login: 'mallory', id: 2 } };
      const { state } = await startLogin();
      const res = await request(app())
        .get('/api/v1/auth/github/callback')
        .query({ code: 'c', state });
      expect(res.status).toBe(403);
      expect(res.text).toContain('"mallory" is not on the Studio allowlist');
      expect(setCookies(res)).toEqual([]);
    });
  });
});

describe('GET /auth/me', () => {
  it('answers 401 without a session cookie', async () => {
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not signed in' });
  });

  it('returns the login and expiry of a valid session', async () => {
    const { cookie } = await signedIn();
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', `other=1; ${cookie}`);
    expect(res.status).toBe(200);
    expect(res.body.login).toBe('octocat');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now() / 1000 + 3500);
  });

  it('answers 401 for a session signed with another secret', async () => {
    const { cookie } = await signedIn('octocat', 3600, 'some-other-secret');
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('answers 401 for an expired session', async () => {
    const { cookie } = await signedIn('octocat', -1);
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('answers 401 for a session whose payload was edited', async () => {
    const { id, cookie } = await signedIn();
    const sig = decodeURIComponent(cookie.split('=')[1]).split('.')[1];
    const forged = Buffer.from(
      JSON.stringify({ sid: id, login: 'admin', exp: 9999999999 }),
    ).toString('base64url');
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${forged}.${sig}`);
    expect(res.status).toBe(401);
  });

  it('reports the dev identity when auth is disabled', async () => {
    env.AUTH_DISABLED = true;
    const res = await request(app()).get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ login: 'dev', authDisabled: true });
  });
});

describe('server-side session state', () => {
  it('answers 401 once the stored session was revoked, even with a valid cookie', async () => {
    const { id, cookie } = await signedIn();
    await store.deps.revokeSession(id, 'octocat');
    const res = await request(app()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('ends existing sessions of a login taken off the allowlist', async () => {
    const { cookie } = await signedIn('octocat');
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
    env.GITHUB_ALLOWED_USERS = 'alice';
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the stored session, not just the cookie', async () => {
    const { id, cookie } = await signedIn();
    const res = await request(app()).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(store.rows.find((r) => r.id === id)?.revokedAt).toBeInstanceOf(Date);
    // a copy of the old cookie no longer works
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
  it('lists the live sessions of the signed-in user, marking the current one', async () => {
    const other = await signedIn('octocat');
    const me = await signedIn('octocat');
    await signedIn('alice');
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

  it('ends another session of the same user, which then stops working', async () => {
    const laptop = await signedIn('octocat');
    const phone = await signedIn('octocat');
    const res = await request(app())
      .delete(`/api/v1/auth/sessions/${phone.id}`)
      .set('Cookie', laptop.cookie);
    expect(res.status).toBe(200);
    expect(setCookies(res)).toEqual([]);
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', phone.cookie)).status).toBe(
      401,
    );
    expect((await request(app()).get('/api/v1/auth/me').set('Cookie', laptop.cookie)).status).toBe(
      200,
    );
  });

  it("will not end someone else's session", async () => {
    const mine = await signedIn('octocat');
    const theirs = await signedIn('alice');
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
    const alice = await signedIn('alice');
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
    expect(res.body.error).toBe('Not Found');
  });
});

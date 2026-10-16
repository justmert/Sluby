import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { env } from '../config/env.js';
import { createAuthRoutes } from '../api/routes/auth.js';
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

const saved = { ...env };
let github: GithubFake;

beforeEach(() => {
  env.GITHUB_CLIENT_ID = 'client-123';
  env.GITHUB_CLIENT_SECRET = 'secret-456';
  env.GITHUB_ALLOWED_USERS = '';
  env.PUBLIC_URL = 'http://localhost:3000';
  env.SESSION_SECRET = SECRET;
  env.AUTH_DISABLED = false;
  github = installGithubFake();
});

afterEach(() => {
  Object.assign(env, saved);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function app() {
  return createTestApp(createAuthRoutes(), '/api/v1/auth');
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
    expect(verifySession(session, SECRET)?.login).toBe('Octocat');
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
    const token = signSession('octocat', SECRET, 3600);
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.body.login).toBe('octocat');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now() / 1000 + 3500);
  });

  it('answers 401 for a session signed with another secret', async () => {
    const token = signSession('octocat', 'some-other-secret', 3600);
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
  });

  it('answers 401 for an expired session', async () => {
    const token = signSession('octocat', SECRET, -1);
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
  });

  it('answers 401 for a session whose payload was edited', async () => {
    const [, sig] = signSession('octocat', SECRET, 3600).split('.');
    const forged = Buffer.from(JSON.stringify({ login: 'admin', exp: 9999999999 })).toString(
      'base64url',
    );
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

describe('POST /auth/logout', () => {
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

describe('unknown auth routes', () => {
  it('fall through to the json 404', async () => {
    const res = await request(app()).get('/api/v1/auth/github/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});

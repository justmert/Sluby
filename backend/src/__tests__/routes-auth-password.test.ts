import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { env } from '../config/env.js';
import { createAuthRoutes } from '../api/routes/auth.js';
import { signSession, SESSION_COOKIE_NAME } from '../api/auth/session.js';
import { setupCode } from '../api/auth/setup-code.js';
import { verifyPassword } from '../api/auth/password.js';
import { createTestApp } from './helpers/express-helpers.js';
import { memoryAccounts } from './helpers/accounts.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));

const SECRET = 'a-test-session-secret-that-is-long-enough-0123456789';
const PASSWORD = 'correct horse battery';
const TOKEN = 't'.repeat(43);

const saved = { ...env };
let accounts: ReturnType<typeof memoryAccounts>;

beforeEach(() => {
  env.PUBLIC_URL = 'http://localhost:3000';
  env.SESSION_SECRET = SECRET;
  env.AUTH_DISABLED = false;
  env.GITHUB_CLIENT_ID = 'client-123';
  env.GITHUB_CLIENT_SECRET = 'secret-456';
  accounts = memoryAccounts();
});

afterEach(() => {
  Object.assign(env, saved);
  vi.useRealTimers();
});

/** One app per test, so the attempt limits carry over between its requests. */
function app() {
  return createTestApp(createAuthRoutes(accounts.authDeps), '/api/v1/auth');
}

function sessionCookieOf(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const cookies = raw ? (Array.isArray(raw) ? raw : [String(raw)]) : [];
  const c = cookies.find((s: string) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  return c?.split(';')[0];
}

/** The account a session cookie stands for, through /me. */
async function whoIs(server: ReturnType<typeof app>, cookie: string) {
  const me = await request(server).get('/api/v1/auth/me').set('Cookie', cookie);
  return me;
}

async function sessionFor(userId: string, identityId: string) {
  const { id } = await accounts.authDeps.createSession({
    userId,
    identityId,
    expiresAt: new Date(Date.now() + 3600_000),
    userAgent: null,
  });
  return {
    id,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSession(id, userId, SECRET))}`,
  };
}

const liveSessions = (userId: string) =>
  accounts.sessions.filter((s) => s.userId === userId && !s.revokedAt);

describe('GET /auth/config', () => {
  it('asks for setup while no admin can sign in, and lists the methods', async () => {
    const server = app();
    expect((await request(server).get('/api/v1/auth/config')).body).toEqual({
      auth_disabled: false,
      setup_required: true,
      methods: { password: true, github: true },
    });

    // a removed admin and the local dev account do not count
    const removed = accounts.addAccount('github', '1', 'old', 'admin');
    accounts.disable(removed.userId);
    await accounts.authDeps.localDevAccount();
    expect((await request(server).get('/api/v1/auth/config')).body.setup_required).toBe(true);

    accounts.addAccount('github', '2', 'admin', 'admin');
    env.GITHUB_CLIENT_SECRET = undefined;
    const res = await request(server).get('/api/v1/auth/config');
    expect(res.body).toEqual({
      auth_disabled: false,
      setup_required: false,
      methods: { password: true, github: false },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('never asks for setup with sign-in off', async () => {
    env.AUTH_DISABLED = true;
    const res = await request(app()).get('/api/v1/auth/config');
    expect(res.body).toMatchObject({ auth_disabled: true, setup_required: false });
  });
});

describe('POST /auth/setup', () => {
  const body = () => ({
    code: setupCode(SECRET).toLowerCase(),
    name: '  Ada  ',
    email: ' Ada@Example.com ',
    password: PASSWORD,
  });

  it('makes the first admin with the logged code and signs them in', async () => {
    const server = app();
    const res = await request(server).post('/api/v1/auth/setup').send(body());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    const cookie = sessionCookieOf(res)!;
    const me = await whoIs(server, cookie);
    expect(me.body).toMatchObject({
      name: 'Ada',
      username: 'ada@example.com',
      provider: 'password',
      provider_label: 'Password',
      role: 'admin',
      sign_in: [{ provider: 'password', username: 'ada@example.com' }],
    });
    const userId = me.body.id as string;
    expect(await verifyPassword(PASSWORD, accounts.passwords.get(userId)!.passwordHash)).toBe(true);
  });

  it('refuses a wrong code with 403 bad_code, naming the field', async () => {
    const res = await request(app())
      .post('/api/v1/auth/setup')
      .send({ ...body(), code: 'AAAAA-AAAAA' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      reason: 'bad_code',
      details: [{ field: 'code', message: expect.any(String) }],
    });
    expect(accounts.users.size).toBe(0);
  });

  it('refuses once an admin exists', async () => {
    accounts.addAccount('github', '1', 'octocat', 'admin');
    const res = await request(app()).post('/api/v1/auth/setup').send(body());
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('already_set_up');
    expect(sessionCookieOf(res)).toBeUndefined();
  });

  it('checks every field, with details per field', async () => {
    const res = await request(app())
      .post('/api/v1/auth/setup')
      .send({ code: setupCode(SECRET), name: ' ', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
    const long = await request(app())
      .post('/api/v1/auth/setup')
      .send({ ...body(), extra: 1 });
    expect(long.status).toBe(400);
  });

  it('allows ten attempts per address in ten minutes, then answers 429', async () => {
    const server = app();
    for (let i = 0; i < 10; i++) {
      const res = await request(server)
        .post('/api/v1/auth/setup')
        .send({ ...body(), code: 'AAAAA-AAAAA' });
      expect(res.status).toBe(403);
    }
    const blocked = await request(server).post('/api/v1/auth/setup').send(body());
    expect(blocked.status).toBe(429);
    expect(blocked.body.retry_after).toBeGreaterThan(0);
    expect(blocked.headers['retry-after']).toBe(String(blocked.body.retry_after));
  });

  it('is off with sign-in off', async () => {
    env.AUTH_DISABLED = true;
    expect((await request(app()).post('/api/v1/auth/setup').send(body())).status).toBe(409);
  });
});

describe('POST /auth/password', () => {
  it('signs a member in with the right password, whatever the email case', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const server = app();
    const res = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: ' ADA@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const cookie = sessionCookieOf(res)!;
    expect(cookie).toBeDefined();
    expect((await whoIs(server, cookie)).body).toMatchObject({
      id: ada.userId,
      provider: 'password',
    });
    expect(accounts.sessions[0]).toMatchObject({ userId: ada.userId, identityId: ada.identityId });
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const server = app();
    const wrong = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: 'not the password' });
    const unknown = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Wrong email or password', reason: 'bad_credentials' });
      expect(sessionCookieOf(res)).toBeUndefined();
    }
  });

  it('turns a removed member away only once the password is right', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    accounts.disable(ada.userId);
    const server = app();
    const wrong = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: 'not the password' });
    expect(wrong.status).toBe(401);
    const right = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.reason).toBe('disabled');
    expect(accounts.sessions).toEqual([]);
  });

  it('allows five wrong passwords per email in fifteen minutes', async () => {
    await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const server = app();
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/api/v1/auth/password')
        .send({ email: 'ada@example.com', password: 'wrong password' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'Ada@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.retry_after).toBeGreaterThan(14 * 60);
    expect(blocked.body.retry_after).toBeLessThanOrEqual(15 * 60);
    // another email from the same address still gets through
    await accounts.addPasswordAccount('bob@example.com', PASSWORD);
    const other = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'bob@example.com', password: PASSWORD });
    expect(other.status).toBe(200);
  });

  it('allows ten attempts per address in ten minutes, right or wrong', async () => {
    await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const server = app();
    for (let i = 0; i < 10; i++) {
      const res = await request(server)
        .post('/api/v1/auth/password')
        .send({ email: 'ada@example.com', password: PASSWORD });
      expect(res.status).toBe(200);
    }
    const blocked = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Too many attempts. Try again in 10 minutes.');

    vi.useFakeTimers({ now: Date.now() + 10 * 60_000 + 1000, toFake: ['Date'] });
    const later = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: PASSWORD });
    expect(later.status).toBe(200);
  });

  it('answers 400 for a body that is not an email and a password', async () => {
    const res = await request(app()).post('/api/v1/auth/password').send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ field: 'password', message: expect.any(String) }]);
  });
});

describe('invite links', () => {
  it('describes an invite for its page', async () => {
    const link = accounts.addLink(TOKEN, { role: 'admin' });
    const res = await request(app()).get(`/api/v1/auth/invites/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kind: 'invite',
      role: 'admin',
      expires_at: link.expiresAt.toISOString(),
      github: true,
    });
  });

  it('answers 404 for an unknown or malformed token and 410 with the reason for a dead one', async () => {
    const server = app();
    expect((await request(server).get(`/api/v1/auth/invites/${'u'.repeat(43)}`)).status).toBe(404);
    expect((await request(server).get('/api/v1/auth/invites/nope')).status).toBe(404);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ usedAt: new Date() }, 'used'],
      [{ revokedAt: new Date() }, 'revoked'],
      [{ expiresAt: new Date(Date.now() - 1) }, 'expired'],
    ];
    for (const [fields, reason] of cases) {
      accounts.links.length = 0;
      accounts.addLink(TOKEN, fields);
      const res = await request(server).get(`/api/v1/auth/invites/${TOKEN}`);
      expect(res.status).toBe(410);
      expect(res.body.reason).toBe(reason);
      const accept = await request(server)
        .post(`/api/v1/auth/invites/${TOKEN}/accept`)
        .send({ name: 'Bob', email: 'bob@example.com', password: PASSWORD });
      expect(accept.status).toBe(410);
      expect(accept.body.reason).toBe(reason);
    }
  });

  it("makes a member with the invite's role, signs them in and uses the invite", async () => {
    const link = accounts.addLink(TOKEN, { role: 'member' });
    const server = app();
    const res = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ name: 'Bob', email: 'Bob@Example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    const me = await whoIs(server, sessionCookieOf(res)!);
    expect(me.body).toMatchObject({ name: 'Bob', role: 'member', username: 'bob@example.com' });
    expect(link.usedAt).toBeInstanceOf(Date);

    const again = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD });
    expect(again.status).toBe(410);
    expect(again.body.reason).toBe('used');
  });

  it('answers 409 email_taken for an email another account has', async () => {
    await accounts.addPasswordAccount('bob@example.com', PASSWORD);
    const link = accounts.addLink(TOKEN);
    const res = await request(app())
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ name: 'Bob', email: 'bob@example.com', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'email_taken', details: [{ field: 'email' }] });
    expect(link.usedAt).toBeNull();
  });

  it('checks the new member fields', async () => {
    accounts.addLink(TOKEN);
    const res = await request(app())
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ name: 'x'.repeat(101), email: 'a@b', password: 'x'.repeat(9) });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });

  it('allows thirty link lookups per address in ten minutes', async () => {
    const server = app();
    for (let i = 0; i < 30; i++) {
      expect((await request(server).get(`/api/v1/auth/invites/${TOKEN}`)).status).toBe(404);
    }
    const blocked = await request(server).get(`/api/v1/auth/invites/${TOKEN}`);
    expect(blocked.status).toBe(429);
  });
});

describe('reset links', () => {
  it('describes a reset link with the email it resets', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    accounts.addLink(TOKEN, { kind: 'reset', userId: ada.userId });
    const res = await request(app()).get(`/api/v1/auth/invites/${TOKEN}`);
    expect(res.body).toMatchObject({ kind: 'reset', email: 'ada@example.com', github: true });
    expect(res.body.role).toBeUndefined();
  });

  it('sets a new password, ends every other session and signs in', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    await sessionFor(ada.userId, ada.identityId);
    await sessionFor(ada.userId, ada.identityId);
    accounts.addLink(TOKEN, { kind: 'reset', userId: ada.userId });
    const server = app();
    const res = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ password: 'a brand new password' });
    expect(res.status).toBe(200);
    expect(liveSessions(ada.userId)).toHaveLength(1);
    expect((await whoIs(server, sessionCookieOf(res)!)).body.id).toBe(ada.userId);

    const old = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'ada@example.com', password: 'a brand new password' });
    expect(fresh.status).toBe(200);
  });

  it('gives a github member a first password, which needs an email', async () => {
    const octo = accounts.addAccount('github', '1', 'octocat');
    accounts.addLink(TOKEN, { kind: 'reset', userId: octo.userId });
    const server = app();
    expect((await request(server).get(`/api/v1/auth/invites/${TOKEN}`)).body.email).toBeNull();
    const missing = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ password: PASSWORD });
    expect(missing.status).toBe(400);
    expect(missing.body.details).toEqual([{ field: 'email', message: expect.any(String) }]);

    const res = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ password: PASSWORD, email: 'Octo@example.com' });
    expect(res.status).toBe(200);
    const signIn = await request(server)
      .post('/api/v1/auth/password')
      .send({ email: 'octo@example.com', password: PASSWORD });
    expect(signIn.status).toBe(200);
  });

  it('refuses another email for an account that has one', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    accounts.addLink(TOKEN, { kind: 'reset', userId: ada.userId });
    const res = await request(app())
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ password: 'a brand new password', email: 'other@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('email');
  });

  it('turns a removed member away', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    accounts.disable(ada.userId);
    accounts.addLink(TOKEN, { kind: 'reset', userId: ada.userId });
    const server = app();
    const look = await request(server).get(`/api/v1/auth/invites/${TOKEN}`);
    expect(look.status).toBe(403);
    expect(look.body.reason).toBe('disabled');
    const use = await request(server)
      .post(`/api/v1/auth/invites/${TOKEN}/accept`)
      .send({ password: 'a brand new password' });
    expect(use.status).toBe(403);
    expect(use.body.reason).toBe('disabled');
  });
});

describe('POST /auth/password/change', () => {
  it('changes the password and ends the other sessions, keeping this one', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const mine = await sessionFor(ada.userId, ada.identityId);
    await sessionFor(ada.userId, ada.identityId);
    const server = app();
    const res = await request(server)
      .post('/api/v1/auth/password/change')
      .set('Cookie', mine.cookie)
      .send({ current_password: PASSWORD, new_password: 'a brand new password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, revoked: 1 });
    expect(liveSessions(ada.userId).map((s) => s.id)).toEqual([mine.id]);
    expect(
      await verifyPassword(
        'a brand new password',
        accounts.passwords.get(ada.userId)!.passwordHash,
      ),
    ).toBe(true);
  });

  it('refuses a wrong current password with 403, naming the field', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const mine = await sessionFor(ada.userId, ada.identityId);
    const res = await request(app())
      .post('/api/v1/auth/password/change')
      .set('Cookie', mine.cookie)
      .send({ current_password: 'not the password', new_password: 'a brand new password' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      reason: 'bad_credentials',
      details: [{ field: 'current_password' }],
    });
  });

  it('needs a session and an account with a password', async () => {
    const server = app();
    const anonymous = await request(server)
      .post('/api/v1/auth/password/change')
      .send({ current_password: PASSWORD, new_password: 'a brand new password' });
    expect(anonymous.status).toBe(401);

    const octo = accounts.addAccount('github', '1', 'octocat');
    const { cookie } = await sessionFor(octo.userId, octo.id);
    const noPassword = await request(server)
      .post('/api/v1/auth/password/change')
      .set('Cookie', cookie)
      .send({ current_password: PASSWORD, new_password: 'a brand new password' });
    expect(noPassword.status).toBe(409);
    expect(noPassword.body.reason).toBe('no_password');
  });

  it('holds the new password to the length rules', async () => {
    const ada = await accounts.addPasswordAccount('ada@example.com', PASSWORD);
    const mine = await sessionFor(ada.userId, ada.identityId);
    const res = await request(app())
      .post('/api/v1/auth/password/change')
      .set('Cookie', mine.cookie)
      .send({ current_password: PASSWORD, new_password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { field: 'new_password', message: 'Use at least 10 characters.' },
    ]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createApiKeyMiddleware,
  requireOperations,
  requireScope,
  type ApiKeyMiddlewareDeps,
} from '../api/middleware/api-key.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';
import type { Request } from 'express';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { SESSION_COOKIE_NAME, signSession } from '../api/auth/session.js';
import { memoryAccounts } from './helpers/accounts.js';

// the path is relative to this test file, as vi.mock resolves it
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    apiKey: undefined,
  } as unknown as Request;
}

function createMockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 200,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
  };
  return res as any;
}

/** Middleware deps with no accounts, no claims and no pins, overridden per test. */
function keyDeps(overrides: Partial<ApiKeyMiddlewareDeps>): ApiKeyMiddlewareDeps {
  return {
    findActiveSession: vi.fn(async () => undefined),
    markSessionSeen: vi.fn(),
    findSession: vi.fn(async () => undefined),
    findApiKeyByHash: vi.fn(),
    recordKeyUse: vi.fn(),
    getAccount: vi.fn(async () => null),
    findLegacyClaim: vi.fn(async () => null),
    isAllowlistEntryPinned: vi.fn(async () => false),
    localDevAccount: vi.fn(async () => {
      throw new Error('not in dev mode');
    }),
    ...overrides,
  };
}

describe('api-key middleware', () => {
  const testToken = 'ws_test_token_abc123';
  const testTokenHash = createHash('sha256').update(testToken).digest('hex');

  const activeApiKey = {
    id: 'key-1',
    name: 'Test Key',
    scopes: ['read', 'upload'],
    rateLimit: 100,
    creatorAddress: '0xabc123',
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
  };

  describe('createApiKeyMiddleware', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const deps = keyDeps({});
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        error: 'Missing or invalid Authorization header',
        reason: 'missing',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const deps = keyDeps({});
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: 'Basic abc123' });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when API key is not found', async () => {
      const deps = keyDeps({ findApiKeyByHash: vi.fn().mockResolvedValue(null) });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(deps.findApiKeyByHash).toHaveBeenCalledWith(testTokenHash);
      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Invalid API key' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when API key is deactivated', async () => {
      const deps = keyDeps({
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, isActive: false }),
      });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'API key is deactivated' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when API key has expired', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const deps = keyDeps({
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, expiresAt: pastDate }),
      });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'API key has expired' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow a valid, active, non-expired API key', async () => {
      const deps = keyDeps({ findApiKeyByHash: vi.fn().mockResolvedValue(activeApiKey) });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toEqual({
        id: 'key-1',
        name: 'Test Key',
        scopes: ['read', 'upload'],
        rateLimit: 100,
        creatorAddress: '0xabc123',
        operator: false,
      });
    });

    it('records the use of a key that authenticates, and of no other', async () => {
      const lastUsedAt = new Date(Date.now() - 120_000);
      const deps = keyDeps({
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, lastUsedAt }),
      });
      await createApiKeyMiddleware(deps)(
        createMockReq({ authorization: `Bearer ${testToken}` }),
        createMockRes() as any,
        vi.fn(),
      );
      expect(deps.recordKeyUse).toHaveBeenCalledWith('key-1', lastUsedAt);

      const refused = keyDeps({
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, isActive: false }),
      });
      await createApiKeyMiddleware(refused)(
        createMockReq({ authorization: `Bearer ${testToken}` }),
        createMockRes() as any,
        vi.fn(),
      );
      expect(refused.recordKeyUse).not.toHaveBeenCalled();
    });

    it('should allow API key with expiresAt in the future', async () => {
      const futureDate = new Date(Date.now() + 86400_000);
      const deps = keyDeps({
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, expiresAt: futureDate }),
      });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 500 when findApiKeyByHash throws', async () => {
      const deps = keyDeps({
        findApiKeyByHash: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      });
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'Internal server error' });
      expect(next).not.toHaveBeenCalled();
      // the mocked logger, so this also proves the mock is the one in use
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Authentication check failed',
      );
    });

    it('should hash the token with SHA-256 before looking it up', async () => {
      const deps = keyDeps({ findApiKeyByHash: vi.fn().mockResolvedValue(null) });
      const middleware = createApiKeyMiddleware(deps);
      const token = 'my-secret-token';
      const expectedHash = createHash('sha256').update(token).digest('hex');

      const req = createMockReq({ authorization: `Bearer ${token}` });
      const res = createMockRes();

      await middleware(req, res as any, vi.fn());

      expect(deps.findApiKeyByHash).toHaveBeenCalledWith(expectedHash);
    });
  });

  describe('callers other than a plain key (resolveCaller)', () => {
    const SECRET = 'a-test-session-secret-that-is-long-enough-0123456789';
    const saved = { ...env };
    let accounts: ReturnType<typeof memoryAccounts>;

    beforeEach(() => {
      env.SESSION_SECRET = SECRET;
      env.AUTH_DISABLED = false;
      env.GITHUB_ALLOWED_USERS = '';
      env.OPERATOR_USERS = '';
      accounts = memoryAccounts();
    });
    afterEach(() => {
      Object.assign(env, saved);
    });

    async function run(headers: Record<string, string>) {
      const req = createMockReq(headers);
      const res = createMockRes();
      const next = vi.fn();
      await createApiKeyMiddleware(accounts.callerDeps)(req, res as any, next);
      return { req, res, next };
    }

    async function sessionCookie(subject = '1', login = 'octocat') {
      const identity = accounts.addAccount('github', subject, login);
      accounts.pin('github', login, subject);
      const { id } = await accounts.authDeps.createSession({
        userId: identity.userId,
        identityId: identity.id,
        expiresAt: new Date(Date.now() + 3600_000),
        userAgent: null,
      });
      const token = signSession(id, identity.userId, SECRET);
      return {
        userId: identity.userId,
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      };
    }

    it('turns a Studio session cookie into a full-scope caller owning user:<id>', async () => {
      const { userId, cookie } = await sessionCookie();
      const { req, next } = await run({ cookie });
      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toEqual({
        id: `session:${userId}`,
        name: 'Studio session (octocat)',
        scopes: ['upload', 'read', 'manage'],
        rateLimit: 1000,
        creatorAddress: `user:${userId}`,
        operator: false,
      });
    });

    it('lets the session win when a cookie and a bearer key are both sent', async () => {
      const { userId, cookie } = await sessionCookie();
      accounts.addKey('sluby_other', { creatorAddress: 'platform' });
      const { req } = await run({ cookie, authorization: 'Bearer sluby_other' });
      expect(req.apiKey?.creatorAddress).toBe(`user:${userId}`);
    });

    it('says why the session ended when a browser sends no key', async () => {
      const { userId, cookie } = await sessionCookie();
      const sid = accounts.sessions.find((x) => x.userId === userId)!.id;
      await accounts.authDeps.revokeSession(sid, userId);
      const { res, next } = await run({ cookie });
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        error: 'Missing or invalid Authorization header',
        reason: 'revoked',
      });
    });

    it('falls back to the bearer key when the cookie is not a live session', async () => {
      accounts.addKey('sluby_other', { creatorAddress: 'platform' });
      const { req } = await run({
        cookie: `${SESSION_COOKIE_NAME}=garbage.sig`,
        authorization: 'Bearer sluby_other',
      });
      expect(req.apiKey?.creatorAddress).toBe('platform');
    });

    it('runs every request as the local dev account when auth is disabled, ignoring keys', async () => {
      env.AUTH_DISABLED = true;
      accounts.addKey('sluby_other', { creatorAddress: 'platform' });
      const a = await run({});
      const b = await run({ authorization: 'Bearer sluby_other' });
      const dev = accounts.identities.find((i) => i.provider === 'local')!;
      for (const { req, next } of [a, b]) {
        expect(next).toHaveBeenCalled();
        expect(req.apiKey?.creatorAddress).toBe(`user:${dev.userId}`);
        expect(req.apiKey?.scopes).toEqual(['upload', 'read', 'manage']);
      }
      // one account, and never the github:dev address a github user could own
      expect(accounts.identities.filter((i) => i.provider === 'local')).toHaveLength(1);
    });

    it('refuses a key of an account taken off the allowlist, and accepts it again once restored', async () => {
      const mallory = accounts.addAccount('github', '666', 'mallory');
      accounts.pin('github', 'mallory', '666');
      accounts.addKey('sluby_mallory', { creatorAddress: `user:${mallory.userId}` });

      env.GITHUB_ALLOWED_USERS = 'alice';
      const refused = await run({ authorization: 'Bearer sluby_mallory' });
      expect(refused.res._status).toBe(401);
      expect(refused.res._json).toEqual({
        error: "API key's account is not allowed on this server",
      });
      expect(refused.next).not.toHaveBeenCalled();

      env.GITHUB_ALLOWED_USERS = 'alice,mallory';
      expect((await run({ authorization: 'Bearer sluby_mallory' })).next).toHaveBeenCalled();
    });

    it('refuses a legacy github:<login> key of a login removed from the allowlist', async () => {
      accounts.addKey('sluby_legacy', { creatorAddress: 'github:mallory' });
      env.GITHUB_ALLOWED_USERS = 'alice';
      expect((await run({ authorization: 'Bearer sluby_legacy' })).res._status).toBe(401);
      env.GITHUB_ALLOWED_USERS = 'alice,mallory';
      const ok = await run({ authorization: 'Bearer sluby_legacy' });
      expect(ok.next).toHaveBeenCalled();
      expect(ok.req.apiKey?.creatorAddress).toBe('github:mallory');
    });

    it('acts as the claiming account for a legacy key left under a claimed address', async () => {
      const alice = accounts.addAccount('github', '1', 'alice');
      accounts.claims.set('github:alice', alice.userId);
      accounts.addKey('sluby_straggler', { creatorAddress: 'github:alice' });
      const { req } = await run({ authorization: 'Bearer sluby_straggler' });
      expect(req.apiKey?.creatorAddress).toBe(`user:${alice.userId}`);
    });

    it('keeps keys of operator-made owners working whatever the allowlist says', async () => {
      env.GITHUB_ALLOWED_USERS = 'alice';
      accounts.addKey('sluby_platform', { creatorAddress: 'platform' });
      expect((await run({ authorization: 'Bearer sluby_platform' })).next).toHaveBeenCalled();
    });

    describe('the operator role', () => {
      it('makes a session of a listed account an operator, and drops it on the next request once unlisted', async () => {
        const { cookie } = await sessionCookie('7', 'octocat');
        env.OPERATOR_USERS = 'github:id:7';
        expect((await run({ cookie })).req.apiKey?.operator).toBe(true);
        env.OPERATOR_USERS = '';
        const after = await run({ cookie });
        expect(after.next).toHaveBeenCalled();
        expect(after.req.apiKey?.operator).toBe(false);
      });

      it('gives a key its account’s operator role at use, and drops it once unlisted', async () => {
        const octo = accounts.addAccount('github', '7', 'octocat');
        accounts.pin('github', 'octocat', '7');
        accounts.addKey('sluby_octo', { creatorAddress: `user:${octo.userId}` });
        const bearer = { authorization: 'Bearer sluby_octo' };

        env.OPERATOR_USERS = 'github:octocat';
        const listed = await run(bearer);
        expect(listed.req.apiKey).toMatchObject({
          creatorAddress: `user:${octo.userId}`,
          operator: true,
        });
        env.OPERATOR_USERS = 'github:someone-else';
        const unlisted = await run(bearer);
        expect(unlisted.next).toHaveBeenCalled();
        expect(unlisted.req.apiKey?.operator).toBe(false);
      });

      it('gives a straggler key under a claimed legacy address its claimant’s role', async () => {
        const octo = accounts.addAccount('github', '7', 'octocat');
        accounts.claims.set('github:octocat', octo.userId);
        accounts.addKey('sluby_old', { creatorAddress: 'github:octocat' });
        env.OPERATOR_USERS = 'github:id:7';
        expect((await run({ authorization: 'Bearer sluby_old' })).req.apiKey?.operator).toBe(true);
      });

      it('never makes an unclaimed legacy key an operator, since it names a login only', async () => {
        accounts.addKey('sluby_legacy', { creatorAddress: 'github:octocat' });
        env.OPERATOR_USERS = 'github:octocat,github:*';
        const { req, next } = await run({ authorization: 'Bearer sluby_legacy' });
        expect(next).toHaveBeenCalled();
        expect(req.apiKey?.operator).toBe(false);
      });

      it('makes nobody an operator through the platform or bootstrap owners', async () => {
        env.OPERATOR_USERS = 'github:*';
        accounts.addKey('sluby_platform', { creatorAddress: PLATFORM_ADDRESS });
        accounts.addKey('sluby_bootstrap', { creatorAddress: 'platform' });
        for (const raw of ['sluby_platform', 'sluby_bootstrap']) {
          expect((await run({ authorization: `Bearer ${raw}` })).req.apiKey?.operator).toBe(false);
        }
      });

      it('makes the local dev account an operator while auth is disabled', async () => {
        env.AUTH_DISABLED = true;
        expect((await run({})).req.apiKey?.operator).toBe(true);
      });

      it('does not keep the dev account an operator once sign-in is on', async () => {
        env.AUTH_DISABLED = true;
        const dev = (await run({})).req.apiKey!;
        env.AUTH_DISABLED = false;
        env.OPERATOR_USERS = 'github:*';
        accounts.addKey('sluby_dev', { creatorAddress: dev.creatorAddress });
        const { req, next } = await run({ authorization: 'Bearer sluby_dev' });
        expect(next).toHaveBeenCalled();
        expect(req.apiKey?.operator).toBe(false);
      });
    });
  });

  describe('requireOperations', () => {
    const caller = (creatorAddress: string, operator: boolean) => ({
      id: 'key-1',
      name: 'Test',
      scopes: ['read'],
      rateLimit: 100,
      creatorAddress,
      operator,
    });

    function guard(apiKey: ReturnType<typeof caller> | undefined) {
      const req = createMockReq();
      req.apiKey = apiKey;
      const res = createMockRes();
      const next = vi.fn();
      requireOperations()(req, res as any, next);
      return { res, next };
    }

    it('admits the platform identity and an operator', () => {
      expect(guard(caller(PLATFORM_ADDRESS, false)).next).toHaveBeenCalled();
      expect(guard(caller('user:x', true)).next).toHaveBeenCalled();
    });

    it('refuses an ordinary tenant and an unauthenticated request with 403', () => {
      for (const apiKey of [caller('user:x', false), caller('platform', false), undefined]) {
        const { res, next } = guard(apiKey);
        expect(res._status).toBe(403);
        expect(res._json).toEqual({
          error: 'Only the platform identity or an operator may use this endpoint',
        });
        expect(next).not.toHaveBeenCalled();
      }
    });
  });

  describe('requireScope', () => {
    it('should return 401 when apiKey is not set on request', () => {
      const middleware = requireScope('read');
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when the required scope is not present', () => {
      const middleware = requireScope('manage');
      const req = createMockReq();
      req.apiKey = {
        id: 'key-1',
        name: 'Test',
        scopes: ['read', 'upload'],
        rateLimit: 100,
        creatorAddress: '0x1',
        operator: false,
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(res._status).toBe(403);
      expect(res._json).toEqual({ error: "Requires 'manage' scope" });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next when the required scope is present', () => {
      const middleware = requireScope('read');
      const req = createMockReq();
      req.apiKey = {
        id: 'key-1',
        name: 'Test',
        scopes: ['read', 'upload'],
        rateLimit: 100,
        creatorAddress: '0x1',
        operator: false,
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle empty scopes array', () => {
      const middleware = requireScope('read');
      const req = createMockReq();
      req.apiKey = {
        id: 'key-1',
        name: 'Test',
        scopes: [],
        rateLimit: 100,
        creatorAddress: '0x1',
        operator: false,
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

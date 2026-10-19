import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createApiKeyMiddleware,
  requireAdmin,
  requireScope,
  type ApiKeyMiddlewareDeps,
} from '../api/middleware/api-key.js';
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

/** Middleware deps with no accounts, overridden per test. */
function keyDeps(overrides: Partial<ApiKeyMiddlewareDeps>): ApiKeyMiddlewareDeps {
  return {
    findActiveSession: vi.fn(async () => undefined),
    markSessionSeen: vi.fn(),
    findSession: vi.fn(async () => undefined),
    findApiKeyByHash: vi.fn(),
    recordKeyUse: vi.fn(),
    getAccount: vi.fn(async () => null),
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
    creatorAddress: 'workspace',
    createdBy: null,
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
        creatorAddress: 'workspace',
        // made from the server, so it acts as an admin
        admin: true,
        userId: null,
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
      expect(res._json).toEqual({ error: 'Internal Server Error' });
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

    async function sessionCookie(
      subject = '1',
      login = 'octocat',
      role: 'admin' | 'member' = 'member',
    ) {
      const identity = accounts.addAccount('github', subject, login, role);
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

    it('turns a member session cookie into a full-scope workspace caller that is not an admin', async () => {
      const { userId, cookie } = await sessionCookie();
      const { req, next } = await run({ cookie });
      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toEqual({
        id: `session:${userId}`,
        name: 'Studio session (octocat)',
        scopes: ['upload', 'read', 'manage'],
        rateLimit: 1000,
        creatorAddress: 'workspace',
        admin: false,
        userId,
      });
    });

    it('makes an admin session an admin, and follows a role change on the next request', async () => {
      const { userId, cookie } = await sessionCookie('2', 'root', 'admin');
      expect((await run({ cookie })).req.apiKey).toMatchObject({ admin: true, userId });
      accounts.setRole(userId, 'member');
      const after = await run({ cookie });
      expect(after.next).toHaveBeenCalled();
      expect(after.req.apiKey?.admin).toBe(false);
    });

    it('lets the session win when a cookie and a bearer key are both sent', async () => {
      const { userId, cookie } = await sessionCookie();
      accounts.addKey('sluby_other');
      const { req } = await run({ cookie, authorization: 'Bearer sluby_other' });
      expect(req.apiKey?.id).toBe(`session:${userId}`);
    });

    it('says why the session ended when a browser sends no key', async () => {
      const { userId, cookie } = await sessionCookie();
      const sid = accounts.sessions.find((x) => x.userId === userId)!.id;
      await accounts.authDeps.revokeSession(sid, userId);
      const { res, next } = await run({ cookie });
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
      // the text says what happened, not that a header was missing
      expect(res._json).toEqual({
        error: 'This session was signed out',
        reason: 'revoked',
      });
    });

    it('ends the session of a removed member with not_allowed, and lets it back once restored', async () => {
      const { userId, cookie } = await sessionCookie();
      accounts.disable(userId);
      const { res, next } = await run({ cookie });
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        error: 'This account was removed from this workspace',
        reason: 'not_allowed',
      });
      accounts.restore(userId);
      expect((await run({ cookie })).next).toHaveBeenCalled();
    });

    it('falls back to the bearer key when the cookie is not a live session', async () => {
      const key = accounts.addKey('sluby_other');
      const { req } = await run({
        cookie: `${SESSION_COOKIE_NAME}=garbage.sig`,
        authorization: 'Bearer sluby_other',
      });
      expect(req.apiKey?.id).toBe(key.id);
    });

    it('runs every request as the local dev account, an admin, when auth is disabled, ignoring keys', async () => {
      env.AUTH_DISABLED = true;
      accounts.addKey('sluby_other');
      const a = await run({});
      const b = await run({ authorization: 'Bearer sluby_other' });
      const dev = accounts.identities.find((i) => i.provider === 'local')!;
      for (const { req, next } of [a, b]) {
        expect(next).toHaveBeenCalled();
        expect(req.apiKey).toMatchObject({
          id: `session:${dev.userId}`,
          creatorAddress: 'workspace',
          admin: true,
          userId: dev.userId,
          scopes: ['upload', 'read', 'manage'],
        });
      }
      expect(accounts.identities.filter((i) => i.provider === 'local')).toHaveLength(1);
    });

    it('makes a key with no creator an admin', async () => {
      const key = accounts.addKey('sluby_seed');
      const { req, next } = await run({ authorization: 'Bearer sluby_seed' });
      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toMatchObject({
        id: key.id,
        creatorAddress: 'workspace',
        admin: true,
        userId: null,
      });
    });

    it("gives a key its creator's current role", async () => {
      const member = accounts.addAccount('github', '5', 'mia');
      accounts.addKey('sluby_mia', { createdBy: member.userId });
      const bearer = { authorization: 'Bearer sluby_mia' };
      expect((await run(bearer)).req.apiKey).toMatchObject({
        creatorAddress: 'workspace',
        admin: false,
        userId: member.userId,
      });
      accounts.setRole(member.userId, 'admin');
      expect((await run(bearer)).req.apiKey?.admin).toBe(true);
    });

    it('refuses the key of a removed member with not_allowed, and accepts it again once restored', async () => {
      const mallory = accounts.addAccount('github', '666', 'mallory', 'admin');
      accounts.addKey('sluby_mallory', { createdBy: mallory.userId });
      accounts.disable(mallory.userId);
      const refused = await run({ authorization: 'Bearer sluby_mallory' });
      expect(refused.res._status).toBe(401);
      expect(refused.res._json).toEqual({
        error: "This API key's creator was removed from this workspace",
        reason: 'not_allowed',
      });
      expect(refused.next).not.toHaveBeenCalled();

      accounts.restore(mallory.userId);
      expect((await run({ authorization: 'Bearer sluby_mallory' })).next).toHaveBeenCalled();
    });

    it('treats a key whose creator row is gone like a key with no creator', async () => {
      accounts.addKey('sluby_orphan', { createdBy: '00000000-0000-4000-8000-00000000ffff' });
      const { req, next } = await run({ authorization: 'Bearer sluby_orphan' });
      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toMatchObject({ admin: true, userId: null });
    });

    it('keeps the dev account an admin through its keys once sign-in is on', async () => {
      env.AUTH_DISABLED = true;
      const dev = (await run({})).req.apiKey!;
      env.AUTH_DISABLED = false;
      accounts.addKey('sluby_dev', { createdBy: dev.userId });
      const { req, next } = await run({ authorization: 'Bearer sluby_dev' });
      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toMatchObject({ admin: true, userId: dev.userId });
    });
  });

  describe('requireAdmin', () => {
    const caller = (admin: boolean) => ({
      id: 'key-1',
      name: 'Test',
      scopes: ['read'],
      rateLimit: 100,
      creatorAddress: 'workspace',
      admin,
      userId: null,
    });

    function guard(apiKey: ReturnType<typeof caller> | undefined) {
      const req = createMockReq();
      req.apiKey = apiKey;
      const res = createMockRes();
      const next = vi.fn();
      requireAdmin()(req, res as any, next);
      return { res, next };
    }

    it('admits an admin', () => {
      expect(guard(caller(true)).next).toHaveBeenCalled();
    });

    it('refuses a member and an unauthenticated request with 403', () => {
      for (const apiKey of [caller(false), undefined]) {
        const { res, next } = guard(apiKey);
        expect(res._status).toBe(403);
        expect(res._json).toEqual({ error: 'Only an admin may use this endpoint' });
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('is tagged for the openapi drift test', () => {
      expect(requireAdmin().requiredIdentity).toBe('admin');
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
        creatorAddress: 'workspace',
        admin: false,
        userId: null,
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
        creatorAddress: 'workspace',
        admin: false,
        userId: null,
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
        creatorAddress: 'workspace',
        admin: false,
        userId: null,
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

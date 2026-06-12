import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createApiKeyMiddleware,
  requireScope,
  type ApiKeyMiddlewareDeps,
} from '../api/middleware/api-key.js';
import type { Request, Response, NextFunction } from 'express';

// Mock logger
vi.mock('../../config/logger.js', () => ({
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
  };

  describe('createApiKeyMiddleware', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn(),
      };
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ error: 'Missing or invalid Authorization header' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn(),
      };
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: 'Basic abc123' });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when API key is not found', async () => {
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue(null),
      };
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
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, isActive: false }),
      };
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
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, expiresAt: pastDate }),
      };
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
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue(activeApiKey),
      };
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
      });
    });

    it('should allow API key with expiresAt in the future', async () => {
      const futureDate = new Date(Date.now() + 86400_000);
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue({ ...activeApiKey, expiresAt: futureDate }),
      };
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 500 when findApiKeyByHash throws', async () => {
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      };
      const middleware = createApiKeyMiddleware(deps);

      const req = createMockReq({ authorization: `Bearer ${testToken}` });
      const res = createMockRes();
      const next = vi.fn();

      await middleware(req, res as any, next);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'Internal server error' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should hash the token with SHA-256 before looking it up', async () => {
      const deps: ApiKeyMiddlewareDeps = {
        findApiKeyByHash: vi.fn().mockResolvedValue(null),
      };
      const middleware = createApiKeyMiddleware(deps);
      const token = 'my-secret-token';
      const expectedHash = createHash('sha256').update(token).digest('hex');

      const req = createMockReq({ authorization: `Bearer ${token}` });
      const res = createMockRes();

      await middleware(req, res as any, vi.fn());

      expect(deps.findApiKeyByHash).toHaveBeenCalledWith(expectedHash);
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
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res as any, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

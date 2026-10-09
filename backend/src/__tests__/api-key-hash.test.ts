import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from '../api/auth/api-key.js';
import { createApiKeyMiddleware } from '../api/middleware/api-key.js';

describe('hashApiKey', () => {
  it('is the sha-256 hex digest of the raw key', () => {
    // reference digests computed with `printf ... | shasum -a 256`
    expect(hashApiKey('sluby_test')).toBe(
      '4c73a19e25ec1a87244c66c26bc75161f073a8e0680c5f7357d37ae1343d5c7c',
    );
    expect(hashApiKey('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is case sensitive and changes with any character', () => {
    expect(hashApiKey('sluby_abc')).not.toBe(hashApiKey('sluby_abC'));
    expect(hashApiKey('sluby_abc')).not.toBe(hashApiKey('sluby_abc '));
  });

  it('is deterministic', () => {
    expect(hashApiKey('sluby_x')).toBe(hashApiKey('sluby_x'));
  });
});

describe('generateApiKey', () => {
  it('mints a sluby_-prefixed key of 32 random bytes in base64url', () => {
    const { key } = generateApiKey();
    expect(API_KEY_PREFIX).toBe('sluby_');
    expect(key).toMatch(/^sluby_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(key.slice(API_KEY_PREFIX.length), 'base64url')).toHaveLength(32);
  });

  it('returns the stored form as the hash of the returned key', () => {
    const { key, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
  });

  it('never repeats', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().key));
    expect(keys.size).toBe(500);
  });
});

describe('a minted key authenticates through the bearer middleware', () => {
  // the middleware's only dependency is the lookup by stored hash, which here
  // is a real map keyed by what generateApiKey said to store
  function harness() {
    const stored = new Map<string, { id: string }>();
    const middleware = createApiKeyMiddleware({
      findActiveSession: async () => undefined,
      markSessionSeen: () => {},
      findSession: async () => undefined,
      getAccount: async () => null,
      findLegacyClaim: async () => null,
      isAllowlistEntryPinned: async () => false,
      localDevAccount: async () => {
        throw new Error('auth is enabled in this test');
      },
      findApiKeyByHash: async (hash) => {
        const row = stored.get(hash);
        if (!row) return null;
        return {
          id: row.id,
          name: 'k',
          scopes: ['read'],
          rateLimit: 10,
          creatorAddress: 'acct',
          isActive: true,
          expiresAt: null,
          lastUsedAt: null,
        };
      },
      recordKeyUse: () => {},
    });
    async function call(authorization: string) {
      const req = { headers: { authorization } } as unknown as Request;
      let status = 200;
      const res = {
        status(code: number) {
          status = code;
          return res;
        },
        json() {
          return res;
        },
      } as unknown as Response;
      let passed = false;
      await middleware(req, res, () => {
        passed = true;
      });
      return { passed, status, apiKey: req.apiKey };
    }
    return { stored, call };
  }

  it('accepts the raw key whose hash was stored', async () => {
    const { stored, call } = harness();
    const { key, hash } = generateApiKey();
    stored.set(hash, { id: 'key-1' });

    const result = await call(`Bearer ${key}`);
    expect(result.passed).toBe(true);
    expect(result.apiKey?.id).toBe('key-1');
  });

  it('rejects the stored hash presented as if it were the key', async () => {
    const { stored, call } = harness();
    const { hash } = generateApiKey();
    stored.set(hash, { id: 'key-1' });

    const result = await call(`Bearer ${hash}`);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(401);
  });

  it('rejects a key that differs by one character', async () => {
    const { stored, call } = harness();
    const { key, hash } = generateApiKey();
    stored.set(hash, { id: 'key-1' });
    const last = key.at(-1) === 'A' ? 'B' : 'A';

    const result = await call(`Bearer ${key.slice(0, -1)}${last}`);
    expect(result.passed).toBe(false);
    expect(result.status).toBe(401);
  });
});

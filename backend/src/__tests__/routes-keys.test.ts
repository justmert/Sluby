import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createKeyRoutes, type ApiKeyRecord, type KeyRouteDeps } from '../api/routes/keys.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import { hashApiKey } from '../api/auth/api-key.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const caller = {
  id: 'session:alice',
  name: 'GitHub session (alice)',
  scopes: ['upload', 'read', 'manage'],
  rateLimit: 1000,
  creatorAddress: 'github:alice',
};

const record = (over: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
  id: 'key-2',
  name: 'ci',
  scopes: ['read'],
  rateLimit: 60,
  isActive: true,
  createdAt: new Date('2026-10-02T10:00:00Z'),
  expiresAt: null,
  prefix: 'sluby_abcdef',
  lastUsedAt: null,
  ...over,
});

describe('key routes', () => {
  let deps: KeyRouteDeps;

  beforeEach(() => {
    deps = {
      createApiKey: vi.fn(async (data) =>
        record({
          id: 'key-1',
          name: data.name,
          scopes: data.scopes,
          rateLimit: data.rateLimit,
          prefix: data.prefix,
        }),
      ),
      listApiKeys: vi.fn().mockResolvedValue({ data: [], hasMore: false, nextCursor: null }),
      deleteApiKey: vi.fn().mockResolvedValue(true),
      renameApiKey: vi.fn(async (id, _owner, name) => record({ id, name })),
      rotateApiKey: vi.fn(),
    };
  });

  const app = (who = caller) => withApiKey(createTestApp(createKeyRoutes(deps)), who);

  it('creates a key owned by the caller and returns the secret once', async () => {
    const res = await request(app())
      .post('/')
      .send({ name: ' ci ', scopes: ['read'], rate_limit: 60 });

    expect(res.status).toBe(201);
    // the listing shape, plus the secret
    expect(res.body).toEqual({
      id: 'key-1',
      name: 'ci',
      scopes: ['read'],
      rate_limit: 60,
      is_active: true,
      created_at: '2026-10-02T10:00:00.000Z',
      expires_at: null,
      prefix: res.body.key.slice(0, 12),
      last_used_at: null,
      key: expect.stringMatching(/^sluby_/),
    });
    // only the hash and the first 12 characters are stored
    expect(deps.createApiKey).toHaveBeenCalledWith(
      {
        keyHash: hashApiKey(res.body.key),
        prefix: res.body.key.slice(0, 12),
        name: 'ci',
        scopes: ['read'],
        rateLimit: 60,
        creatorAddress: 'github:alice',
      },
      100,
    );
  });

  it.each([
    [{ name: '' }, /name is required/],
    [{}, /name/],
    [{ name: 'x', scopes: 'read' }, /scopes must be/],
    [{ name: 'x', scopes: [] }, /scopes must be/],
    [{ name: 'x', scopes: ['admin'] }, /scopes must be from/],
    [{ name: 'x', rate_limit: 0 }, /rate_limit/],
    [{ name: 'x', rate_limit: 2 ** 31 }, /rate_limit/],
    [{ name: 'a\u0000b' }, /control characters/],
    [{ name: 'x'.repeat(101) }, /at most 100/],
    [{ name: 'x', owner: 'github:bob' }, /unknown field: owner/],
    [{ name: 'x', rate_limit: 10001 }, /rate_limit must be at most 10000/],
  ])('rejects %j', async (body, message) => {
    const res = await request(app()).post('/').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('stores a scope listed twice once', async () => {
    const res = await request(app())
      .post('/')
      .send({ name: 'ci', scopes: ['read', 'upload', 'read'] });
    expect(res.status).toBe(201);
    expect(vi.mocked(deps.createApiKey).mock.calls[0][0].scopes).toEqual(['read', 'upload']);
  });

  it('refuses a key once the account holds the maximum', async () => {
    vi.mocked(deps.createApiKey).mockResolvedValue(null);
    const limited = withApiKey(
      createTestApp(createKeyRoutes(deps, { rateLimitMax: 500, keysPerAccountMax: 2 })),
      caller,
    );
    const res = await request(limited).post('/').send({ name: 'one too many' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has 2 API keys/);
    expect(vi.mocked(deps.createApiKey).mock.calls[0][1]).toBe(2);
    // the listing tells a form the same limits
    const list = await request(limited).get('/');
    expect(list.body.limits).toEqual({ max_keys: 2, max_rate_limit: 500 });
  });

  it('lists keys with their expiry', async () => {
    vi.mocked(deps.listApiKeys).mockResolvedValue({
      data: [
        record({
          expiresAt: new Date('2026-10-03T10:00:00Z'),
          lastUsedAt: new Date('2026-10-02T11:00:00Z'),
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
    const res = await request(app()).get('/');
    expect(deps.listApiKeys).toHaveBeenCalledWith('github:alice', { limit: 1000 });
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.limits).toEqual({ max_keys: 100, max_rate_limit: 10000 });
    expect(res.body.data[0]).toEqual({
      id: 'key-2',
      name: 'ci',
      scopes: ['read'],
      rate_limit: 60,
      is_active: true,
      created_at: '2026-10-02T10:00:00.000Z',
      expires_at: '2026-10-03T10:00:00.000Z',
      prefix: 'sluby_abcdef',
      last_used_at: '2026-10-02T11:00:00.000Z',
    });
  });

  describe('rotate', () => {
    it('issues a replacement and retires the old key after the grace period', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') });
      vi.mocked(deps.rotateApiKey).mockImplementation(async (_id, _owner, _r, retireAt) => ({
        status: 'rotated',
        replacement: record({ id: 'key-3' }),
        retiredAt: retireAt,
      }));

      const res = await request(app()).post('/key-2/rotate').send({ grace_period_seconds: 3600 });

      expect(res.status).toBe(201);
      const [id, owner, replacement, retireAt] = vi.mocked(deps.rotateApiKey).mock.calls[0];
      expect([id, owner]).toEqual(['key-2', 'github:alice']);
      expect(retireAt.toISOString()).toBe('2026-10-02T13:00:00.000Z');
      expect(res.body).toMatchObject({
        id: 'key-3',
        rotated_from: 'key-2',
        previous_key_expires_at: '2026-10-02T13:00:00.000Z',
      });
      expect(replacement.keyHash).toBe(hashApiKey(res.body.key));
      expect(replacement.prefix).toBe(res.body.key.slice(0, 12));
      vi.useRealTimers();
    });

    it('retires the old key immediately by default', async () => {
      vi.mocked(deps.rotateApiKey).mockImplementation(async (_id, _o, _r, retireAt) => ({
        status: 'rotated',
        replacement: record({ id: 'key-3' }),
        retiredAt: retireAt,
      }));
      const before = Date.now();
      await request(app()).post('/key-2/rotate').send({});
      const retireAt = vi.mocked(deps.rotateApiKey).mock.calls[0][3];
      expect(retireAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(retireAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it.each([-1, 1.5, 8 * 24 * 3600, 'soon'])('rejects grace %s', async (grace) => {
      const res = await request(app()).post('/key-2/rotate').send({ grace_period_seconds: grace });
      expect(res.status).toBe(400);
      expect(deps.rotateApiKey).not.toHaveBeenCalled();
    });

    it('answers 404 for a key the caller does not own or that is retired', async () => {
      vi.mocked(deps.rotateApiKey).mockResolvedValue({ status: 'not_found' });
      const res = await request(app()).post('/key-9/rotate').send({});
      expect(res.status).toBe(404);
    });

    it('answers 409 for a key that was already rotated', async () => {
      vi.mocked(deps.rotateApiKey).mockResolvedValue({
        status: 'already_rotated',
        replacedById: 'key-3',
      });
      const res = await request(app()).post('/key-2/rotate').send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('This key was already rotated. Rotate its replacement instead.');
    });
  });

  describe('rename', () => {
    it('renames a key of the caller, trimming the name', async () => {
      const res = await request(app()).patch('/key-2').send({ name: ' deploy bot ' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'key-2', name: 'deploy bot' });
      expect(deps.renameApiKey).toHaveBeenCalledWith('key-2', 'github:alice', 'deploy bot');
    });

    it('answers 404 for a key the caller cannot rename', async () => {
      vi.mocked(deps.renameApiKey).mockResolvedValue(null);
      const res = await request(app()).patch('/key-9').send({ name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('API key not found');
    });

    it.each([{}, { name: '' }, { name: 'x'.repeat(101) }, { name: 'x', scopes: ['read'] }])(
      'rejects %j',
      async (body) => {
        const res = await request(app()).patch('/key-2').send(body);
        expect(res.status).toBe(400);
        expect(deps.renameApiKey).not.toHaveBeenCalled();
      },
    );
  });

  it('revokes only within the account', async () => {
    vi.mocked(deps.deleteApiKey).mockResolvedValue(false);
    const res = await request(app()).delete('/key-2');
    expect(deps.deleteApiKey).toHaveBeenCalledWith('key-2', 'github:alice');
    expect(res.status).toBe(404);
  });

  it('requires the manage scope', async () => {
    const res = await request(app({ ...caller, scopes: ['read'] })).get('/');
    expect(res.status).toBe(403);
  });
});

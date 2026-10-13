import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createKeyRoutes, type ApiKeyRecord, type KeyRouteDeps } from '../api/routes/keys.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import { hashApiKey } from '../api/auth.js';

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
  ...over,
});

describe('key routes', () => {
  let deps: KeyRouteDeps;

  beforeEach(() => {
    deps = {
      createApiKey: vi.fn().mockResolvedValue({ id: 'key-1' }),
      listApiKeys: vi.fn().mockResolvedValue([]),
      deleteApiKey: vi.fn().mockResolvedValue(true),
      rotateApiKey: vi.fn(),
    };
  });

  const app = (who = caller) => withApiKey(createTestApp(createKeyRoutes(deps)), who);

  it('creates a key owned by the caller and returns the secret once', async () => {
    const res = await request(app())
      .post('/')
      .send({ name: ' ci ', scopes: ['read'], rate_limit: 60 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'key-1', name: 'ci', scopes: ['read'], rate_limit: 60 });
    expect(res.body.key).toMatch(/^sluby_/);
    // only the hash is stored
    expect(deps.createApiKey).toHaveBeenCalledWith({
      keyHash: hashApiKey(res.body.key),
      name: 'ci',
      scopes: ['read'],
      rateLimit: 60,
      creatorAddress: 'github:alice',
    });
  });

  it.each([
    [{ name: '' }, /Name is required/],
    [{ name: 'x', scopes: 'read' }, /scopes must be/],
    [{ name: 'x', scopes: [] }, /scopes must be/],
    [{ name: 'x', scopes: ['admin'] }, /Invalid scopes: admin/],
    [{ name: 'x', rate_limit: 0 }, /rate_limit/],
  ])('rejects %j', async (body, message) => {
    const res = await request(app()).post('/').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('lists keys with their expiry', async () => {
    vi.mocked(deps.listApiKeys).mockResolvedValue([
      record({ expiresAt: new Date('2026-10-03T10:00:00Z') }),
    ]);
    const res = await request(app()).get('/');
    expect(deps.listApiKeys).toHaveBeenCalledWith('github:alice');
    expect(res.body.data[0]).toEqual({
      id: 'key-2',
      name: 'ci',
      scopes: ['read'],
      rate_limit: 60,
      is_active: true,
      created_at: '2026-10-02T10:00:00.000Z',
      expires_at: '2026-10-03T10:00:00.000Z',
    });
  });

  describe('rotate', () => {
    it('issues a replacement and retires the old key after the grace period', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') });
      vi.mocked(deps.rotateApiKey).mockImplementation(async (_id, _owner, _r, retireAt) => ({
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
      vi.useRealTimers();
    });

    it('retires the old key immediately by default', async () => {
      vi.mocked(deps.rotateApiKey).mockImplementation(async (_id, _o, _r, retireAt) => ({
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
      vi.mocked(deps.rotateApiKey).mockResolvedValue(null);
      const res = await request(app()).post('/key-9/rotate').send({});
      expect(res.status).toBe(404);
    });
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

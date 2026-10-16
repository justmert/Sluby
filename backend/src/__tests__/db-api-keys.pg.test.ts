import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { generateApiKey, hashApiKey } from '../api/auth/api-key.js';
import { decodeCursor } from '../api/pagination.js';
import type * as ApiKeyQueries from '../db/queries/api-keys.js';
import type * as Seeding from '../db/api-key-seeding.js';
import type * as Middleware from '../api/middleware/api-key.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('api key queries and seeding (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof ApiKeyQueries;
  let seeding: typeof Seeding;
  let middleware: typeof Middleware;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/api-keys.js');
    seeding = await import('../db/api-key-seeding.js');
    middleware = await import('../api/middleware/api-key.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const newKey = (overrides: Partial<Parameters<typeof q.createApiKey>[0]> = {}) =>
    q.createApiKey({
      name: 'k',
      scopes: ['read'],
      creatorAddress: 'alice',
      ...overrides,
    });

  // the key a bearer token names, if it is active and unexpired; the
  // middleware tests at the end check the same rules through the real path
  const usable = async (rawKey: string) => {
    const key = await q.getApiKeyByHash(hashApiKey(rawKey));
    return key?.isActive && !(key.expiresAt && key.expiresAt < new Date()) ? key : undefined;
  };

  describe('createApiKey', () => {
    it('stores only the sha-256 of a generated sluby_ key', async () => {
      const { apiKey, rawKey } = await newKey();
      expect(rawKey).toMatch(/^sluby_[A-Za-z0-9_-]{43}$/);
      expect(apiKey.keyHash).toBe(hashApiKey(rawKey));
      const rows = await tdb.sql`select * from api_keys`;
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toContain(rawKey);
      expect(rows[0]).toMatchObject({ rate_limit: 100, is_active: true, expires_at: null });
    });

    it('hashes a caller-supplied raw key the same way', async () => {
      const { apiKey, rawKey } = await newKey({ rawKey: 'sluby_chosen' });
      expect(rawKey).toBe('sluby_chosen');
      expect(apiKey.keyHash).toBe(hashApiKey('sluby_chosen'));
    });

    it('refuses a second key with the same hash', async () => {
      await newKey({ rawKey: 'sluby_dup' });
      await expect(newKey({ rawKey: 'sluby_dup' })).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    });
  });

  describe('lookup and validation', () => {
    it('finds a key by the hash of the raw key', async () => {
      const { apiKey, rawKey } = await newKey();
      expect((await q.getApiKeyByHash(hashApiKey(rawKey)))?.id).toBe(apiKey.id);
      expect(await q.getApiKeyByHash(hashApiKey(`${rawKey}x`))).toBeUndefined();
      // the stored hash is not itself a key
      expect(await q.getApiKeyByHash(hashApiKey(apiKey.keyHash))).toBeUndefined();
    });
  });

  describe('listApiKeys', () => {
    it('lists the owner’s usable keys, newest first', async () => {
      const older = await newKey({ name: 'older' });
      await tdb.sql`update api_keys set created_at = now() - interval '1 day' where id = ${older.apiKey.id}`;
      await newKey({ name: 'newer' });
      await newKey({ name: 'grace', expiresAt: new Date(Date.now() + 60_000) });
      await newKey({ name: 'off', isActive: false });
      await newKey({ name: 'expired', expiresAt: new Date(Date.now() - 1) });
      await newKey({ name: 'bobs', creatorAddress: 'bob' });

      const names = (await q.listApiKeys({ creatorAddress: 'alice', limit: 100 })).data.map(
        (k) => k.name,
      );
      expect(names.slice(-1)).toEqual(['older']);
      expect([...names].sort()).toEqual(['grace', 'newer', 'older']);
    });

    it('includes inactive and expired keys when asked', async () => {
      await newKey({ name: 'on' });
      await newKey({ name: 'off', isActive: false });
      await newKey({ name: 'expired', expiresAt: new Date(Date.now() - 1) });
      const names = (
        await q.listApiKeys({ creatorAddress: 'alice', includeInactive: true, limit: 100 })
      ).data.map((k) => k.name);
      expect(names.sort()).toEqual(['expired', 'off', 'on']);
    });

    it('pages newest first with a cursor, across keys created in the same millisecond', async () => {
      for (let i = 0; i < 5; i++) {
        const k = await newKey({ name: `k${i}` });
        await tdb.sql`update api_keys set created_at = now() - make_interval(mins => ${10 - i}) where id = ${k.apiKey.id}`;
      }
      // two keys sharing a timestamp still page apart through the id
      const twinA = await newKey({ name: 'twin-a' });
      const twinB = await newKey({ name: 'twin-b' });
      await tdb.sql`update api_keys set created_at = '2020-01-01T00:00:00.000Z' where id in (${twinA.apiKey.id}, ${twinB.apiKey.id})`;

      const first = await q.listApiKeys({ creatorAddress: 'alice', limit: 2 });
      expect(first.data.map((k) => k.name)).toEqual(['k4', 'k3']);
      expect(first.hasMore).toBe(true);
      const names: string[] = first.data.map((k) => k.name);
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await q.listApiKeys({
          creatorAddress: 'alice',
          limit: 2,
          cursor: decodeCursor(cursor)!,
        });
        names.push(...page.data.map((k) => k.name));
        cursor = page.nextCursor;
      }
      expect(names.slice(0, 5)).toEqual(['k4', 'k3', 'k2', 'k1', 'k0']);
      expect(names.slice(5).sort()).toEqual(['twin-a', 'twin-b']);
    });

    it('lists every account when no owner is given, and none for an empty owner', async () => {
      await newKey({ name: 'alices' });
      await newKey({ name: 'bobs', creatorAddress: 'bob' });
      const all = await q.listApiKeys({ limit: 100 });
      expect(all.data.map((k) => k.name).sort()).toEqual(['alices', 'bobs']);
      const empty = await q.listApiKeys({ creatorAddress: '', limit: 100 });
      expect(empty.data).toEqual([]);
    });
  });

  describe('deleteApiKey', () => {
    it('deletes only within the owner’s account', async () => {
      const { apiKey } = await newKey();
      expect(await q.deleteApiKey(apiKey.id, 'bob')).toBeUndefined();
      expect(await q.getApiKeyByHash(apiKey.keyHash)).toBeDefined();
      expect((await q.deleteApiKey(apiKey.id, 'alice'))?.id).toBe(apiKey.id);
      expect(await q.getApiKeyByHash(apiKey.keyHash)).toBeUndefined();
    });

    it('keeps a webhook registered with the key, unlinked', async () => {
      const { apiKey } = await newKey();
      const [hook] = await tdb.sql`
        insert into webhook_endpoints (creator_address, api_key_id, url, events, secret)
        values ('alice', ${apiKey.id}, 'https://h.example', '{asset.ready}', 's')
        returning id
      `;
      await q.deleteApiKey(apiKey.id, 'alice');
      const [after] = await tdb.sql`select api_key_id from webhook_endpoints where id = ${hook.id}`;
      expect(after.api_key_id).toBeNull();
    });
  });

  describe('rotateApiKey', () => {
    it('mints a replacement with the same settings and retires the old key at the given time', async () => {
      const old = await newKey({ name: 'ci', scopes: ['read', 'upload'], rateLimit: 42 });
      const next = generateApiKey();
      const retireAt = new Date(Date.now() + 3600_000);

      const result = await q.rotateApiKey(old.apiKey.id, 'alice', next.hash, retireAt);
      if (result.status !== 'rotated') throw new Error(`not rotated: ${result.status}`);
      expect(result.replacement).toMatchObject({
        name: 'ci',
        scopes: ['read', 'upload'],
        rateLimit: 42,
        creatorAddress: 'alice',
        keyHash: next.hash,
        isActive: true,
        expiresAt: null,
      });
      expect(result.retiredAt.getTime()).toBe(retireAt.getTime());
      const [row] = await tdb.sql`select replaced_by_id from api_keys where id = ${old.apiKey.id}`;
      expect(row.replaced_by_id).toBe(result.replacement.id);

      // both work during the grace period, then only the new one
      expect(await usable(old.rawKey)).toBeDefined();
      expect(await usable(next.key)).toBeDefined();
      await tdb.sql`update api_keys set expires_at = now() - interval '1 second' where id = ${old.apiKey.id}`;
      expect(await usable(old.rawKey)).toBeUndefined();
      expect(await usable(next.key)).toBeDefined();
    });

    it('retires the old key at once with no grace period', async () => {
      const old = await newKey();
      await q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, new Date());
      expect(await usable(old.rawKey)).toBeUndefined();
    });

    it('never pushes an earlier expiry out', async () => {
      const soon = new Date(Date.now() + 60_000);
      const old = await newKey({ expiresAt: soon });
      const result = await q.rotateApiKey(
        old.apiKey.id,
        'alice',
        generateApiKey().hash,
        new Date(Date.now() + 7 * 86400_000),
      );
      if (result.status !== 'rotated') throw new Error(`not rotated: ${result.status}`);
      expect(result.retiredAt.getTime()).toBe(soon.getTime());
      const [row] = await tdb.sql`select expires_at from api_keys where id = ${old.apiKey.id}`;
      expect((row.expires_at as Date).getTime()).toBe(soon.getTime());
    });

    it('refuses another owner’s key, an inactive key and an expired key', async () => {
      const mine = await newKey();
      const off = await newKey({ isActive: false });
      const gone = await newKey({ expiresAt: new Date(Date.now() - 1) });
      const hash = () => generateApiKey().hash;

      expect(await q.rotateApiKey(mine.apiKey.id, 'bob', hash(), new Date())).toEqual({
        status: 'not_found',
      });
      expect(await q.rotateApiKey(off.apiKey.id, 'alice', hash(), new Date())).toEqual({
        status: 'not_found',
      });
      expect(await q.rotateApiKey(gone.apiKey.id, 'alice', hash(), new Date())).toEqual({
        status: 'not_found',
      });
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(3);
    });

    it('lets only one of two concurrent immediate rotations mint a replacement', async () => {
      const old = await newKey();
      const results = await Promise.all([
        q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, new Date()),
        q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, new Date()),
      ]);
      expect(results.filter((r) => r.status === 'rotated')).toHaveLength(1);
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(2);
    });

    it('lets only one of two concurrent rotations with a grace period mint a replacement', async () => {
      const old = await newKey();
      const later = new Date(Date.now() + 3600_000);
      const results = await Promise.all([
        q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, later),
        q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, later),
      ]);
      const rotated = results.filter((r) => r.status === 'rotated');
      expect(rotated).toHaveLength(1);
      expect(results.filter((r) => r.status === 'already_rotated')).toEqual([
        {
          status: 'already_rotated',
          replacedById: rotated[0].status === 'rotated' ? rotated[0].replacement.id : null,
        },
      ]);
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(2);
    });

    it('refuses to rotate a key again during its grace period', async () => {
      const old = await newKey();
      const later = new Date(Date.now() + 3600_000);
      const first = await q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, later);
      expect(first.status).toBe('rotated');
      const second = await q.rotateApiKey(old.apiKey.id, 'alice', generateApiKey().hash, later);
      expect(second.status).toBe('already_rotated');
      // the old key keeps working until its grace period ends, and the
      // replacement can itself be rotated
      expect(await usable(old.rawKey)).toBeDefined();
      if (first.status !== 'rotated') throw new Error('not rotated');
      const third = await q.rotateApiKey(
        first.replacement.id,
        'alice',
        generateApiKey().hash,
        later,
      );
      expect(third.status).toBe('rotated');
    });

    it('rolls back the replacement when the new hash collides', async () => {
      const a = await newKey();
      const b = await newKey();
      await expect(
        q.rotateApiKey(a.apiKey.id, 'alice', b.apiKey.keyHash, new Date()),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
      expect(await usable(a.rawKey)).toBeDefined();
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(2);
    });
  });

  describe('bootstrap key seeding', () => {
    it('creates the BOOTSTRAP_API_KEY as a full-scope platform key that validates', async () => {
      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_bootstrap_secret')).toBe(
        'created',
      );
      const key = await usable('sluby_bootstrap_secret');
      expect(key).toMatchObject({
        name: 'bootstrap',
        scopes: ['upload', 'read', 'manage'],
        rateLimit: 1000,
        creatorAddress: 'platform',
        isActive: true,
        expiresAt: null,
      });
    });

    it('is idempotent across restarts', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('exists');
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(1);
    });

    it('leaves a rotated bootstrap key retired', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      const row = await q.getApiKeyByHash(hashApiKey('sluby_boot'));
      await q.rotateApiKey(row!.id, undefined, generateApiKey().hash, new Date());

      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('exists');
      expect(await usable('sluby_boot')).toBeUndefined();
    });

    it('never seeds a deleted bootstrap key again', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      const row = await q.getApiKeyByHash(hashApiKey('sluby_boot'));
      await q.deleteApiKey(row!.id);

      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('retired');
      expect(await usable('sluby_boot')).toBeUndefined();
    });

    it('keeps a rotated bootstrap key retired after its expired row is deleted', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      const row = await q.getApiKeyByHash(hashApiKey('sluby_boot'));
      await q.rotateApiKey(row!.id, undefined, generateApiKey().hash, new Date());
      await q.deleteApiKey(row!.id);

      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('retired');
      expect(await usable('sluby_boot')).toBeUndefined();
    });

    it('seeds a new bootstrap value after the old one was retired', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      await q.deleteApiKey((await q.getApiKeyByHash(hashApiKey('sluby_boot')))!.id);
      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot_2')).toBe('created');
      expect(await usable('sluby_boot_2')).toBeDefined();
    });

    it('seeds once when replicas start together', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => seeding.seedBootstrapApiKey(database.db, 'sluby_boot')),
      );
      expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'exists')).toHaveLength(4);
      const [{ n }] = await tdb.sql`select count(*)::int as n from api_keys`;
      expect(n).toBe(1);
    });

    it('treats a bootstrap key from before bootstrap_keys existed as seeded', async () => {
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      await tdb.sql`delete from bootstrap_keys`;
      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('exists');
      const [{ n }] = await tdb.sql`select count(*)::int as n from bootstrap_keys`;
      expect(n).toBe(1);
    });

    it('adds the bootstrap key alongside keys that already exist', async () => {
      await newKey();
      expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_boot')).toBe('created');
    });
  });

  describe('cli admin key seeding', () => {
    it('mints a full-scope key for the given account and returns it once', async () => {
      const { id, rawKey } = await seeding.createAdminApiKey({
        name: 'ops',
        creatorAddress: `0x${'0'.repeat(64)}`,
      });
      expect(rawKey).toMatch(/^sluby_[A-Za-z0-9_-]{43}$/);
      expect(await usable(rawKey)).toMatchObject({
        id,
        name: 'ops',
        scopes: ['upload', 'read', 'manage'],
        rateLimit: 1000,
        creatorAddress: `0x${'0'.repeat(64)}`,
      });
    });
  });

  describe('bearer middleware over the real lookup', () => {
    async function authenticate(token: string) {
      // the same adapter index.ts gives the middleware
      const accounts = await import('../db/queries/accounts.js');
      const mw = middleware.createApiKeyMiddleware({
        findActiveSession: async () => undefined,
        findApiKeyByHash: async (hash) => (await q.getApiKeyByHash(hash)) ?? null,
        getAccount: accounts.getAccount,
        findLegacyClaim: accounts.findLegacyClaim,
        isAllowlistEntryPinned: accounts.isAllowlistEntryPinned,
        localDevAccount: async () => {
          throw new Error('auth is enabled in this test');
        },
      });
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      let status = 200;
      let body: unknown;
      const res = {
        status(c: number) {
          status = c;
          return res;
        },
        json(b: unknown) {
          body = b;
          return res;
        },
      } as unknown as Response;
      let passed = false;
      await mw(req, res, () => {
        passed = true;
      });
      return { passed, status, body, apiKey: req.apiKey };
    }

    it('authenticates keys from every minting path', async () => {
      const created = await newKey();
      await seeding.seedBootstrapApiKey(database.db, 'sluby_boot');
      const admin = await seeding.createAdminApiKey({
        name: 'a',
        creatorAddress: 'ops',
      });

      expect((await authenticate(created.rawKey)).apiKey?.creatorAddress).toBe('alice');
      expect((await authenticate('sluby_boot')).apiKey?.creatorAddress).toBe('platform');
      expect((await authenticate(admin.rawKey)).apiKey?.creatorAddress).toBe('ops');
    });

    it('answers 401 with the reason for unknown, deactivated and expired keys', async () => {
      const off = await newKey({ isActive: false });
      const old = await newKey({ expiresAt: new Date(Date.now() - 1000) });

      expect(await authenticate(generateApiKey().key)).toMatchObject({
        passed: false,
        status: 401,
        body: { error: 'Invalid API key' },
      });
      expect(await authenticate(off.rawKey)).toMatchObject({
        status: 401,
        body: { error: 'API key is deactivated' },
      });
      expect(await authenticate(old.rawKey)).toMatchObject({
        status: 401,
        body: { error: 'API key has expired' },
      });
    });
  });
});

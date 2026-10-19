import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AccountQueries from '../db/queries/accounts.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('accounts and identities (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof AccountQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/accounts.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  /** A member with a github identity, as an invite will make one. */
  async function member(subject: string, login: string, role: 'admin' | 'member' = 'member') {
    const [user] = await tdb.sql`
      insert into users (display_name, role) values (${login}, ${role}) returning id`;
    const [identity] = await tdb.sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${user.id}, 'github', ${subject}, ${login}) returning id`;
    return { userId: user.id as string, identityId: identity.id as string };
  }

  const signIn = (subject: string, login: string): Promise<AccountQueries.SignInResult> =>
    q.signInIdentity({ provider: 'github', subject, username: login, displayName: login });

  it('returns an account with its role, removal state and identities', async () => {
    const { userId, identityId } = await member('1', 'Octocat', 'admin');
    expect(await q.getAccount(userId)).toEqual({
      id: userId,
      displayName: 'Octocat',
      role: 'admin',
      disabledAt: null,
      identities: [{ id: identityId, provider: 'github', subject: '1', username: 'Octocat' }],
    });
    await tdb.sql`update users set disabled_at = now() where id = ${userId}`;
    expect((await q.getAccount(userId))?.disabledAt).toBeInstanceOf(Date);
  });

  it('signs a member in by the numeric id, updating its handle and name', async () => {
    const { userId, identityId } = await member('1', 'octocat');
    expect(await signIn('1', 'octocat-renamed')).toEqual({
      status: 'signed_in',
      userId,
      identityId,
      displayName: 'octocat-renamed',
    });
    const [row] = await tdb.sql`select username from user_identities`;
    expect(row.username).toBe('octocat-renamed');
    const [user] = await tdb.sql`select display_name from users`;
    expect(user.display_name).toBe('octocat-renamed');
  });

  it('refuses an identity nobody added, and makes no account for it', async () => {
    expect(await signIn('7', 'mallory')).toEqual({ status: 'refused', reason: 'not_a_member' });
    const [{ n }] = await tdb.sql`select count(*)::int as n from users`;
    expect(n).toBe(0);
  });

  it('refuses the new owner of a member login (a recycled github name)', async () => {
    await member('1', 'octocat');
    expect(await signIn('99', 'octocat')).toEqual({ status: 'refused', reason: 'not_a_member' });
  });

  it('refuses a removed member without touching their identity', async () => {
    const { userId } = await member('1', 'octocat');
    await tdb.sql`update users set disabled_at = now() where id = ${userId}`;
    expect(await signIn('1', 'octocat-renamed')).toEqual({ status: 'refused', reason: 'disabled' });
    const [row] = await tdb.sql`select username from user_identities`;
    expect(row.username).toBe('octocat');
  });

  it('signs the same member in many times at once', async () => {
    const { userId } = await member('1', 'octocat');
    const results = await Promise.all(Array.from({ length: 8 }, () => signIn('1', 'octocat')));
    expect(results.every((r) => r.status === 'signed_in' && r.userId === userId)).toBe(true);
  });

  it('makes one local dev account however often and concurrently it is asked for, as an admin', async () => {
    const dev = {
      provider: 'local',
      subject: 'dev',
      username: 'dev',
      displayName: 'Local developer',
      role: 'admin' as const,
    };
    const all = await Promise.all(Array.from({ length: 5 }, () => q.ensureIdentityAccount(dev)));
    expect(new Set(all.map((a) => a.userId)).size).toBe(1);
    expect(await q.ensureIdentityAccount(dev)).toEqual(all[0]);
    expect((await q.getAccount(all[0].userId))?.role).toBe('admin');
  });

  it('returns null for an account that does not exist', async () => {
    expect(await q.getAccount('5c1e6a3d-8a7b-4f2c-9e1d-0b2a3c4d5e6f')).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as SessionQueries from '../db/queries/sessions.js';
import type * as Database from '../config/database.js';
import type * as AccountQueries from '../db/queries/accounts.js';

describe.skipIf(!hasTestDatabase)('studio session queries (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof SessionQueries;
  let database: typeof Database;
  let accounts: typeof AccountQueries;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/sessions.js');
    database = await import('../config/database.js');
    accounts = await import('../db/queries/accounts.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  // an account per login, made once per test
  let made: Map<string, Promise<{ userId: string; identityId: string }>>;
  beforeEach(async () => {
    await tdb.truncate();
    made = new Map();
  });

  const account = (login: string) => {
    if (!made.has(login)) {
      made.set(
        login,
        accounts.ensureIdentityAccount({
          provider: 'github',
          subject: `id-${login}`,
          username: login,
          displayName: login,
        }),
      );
    }
    return made.get(login)!;
  };
  const uid = async (login: string) => (await account(login)).userId;

  const inAnHour = () => new Date(Date.now() + 3600_000);
  const newSession = async (login = 'octocat', expiresAt = inAnHour()) =>
    q.createStudioSession({ ...(await account(login)), expiresAt, userAgent: 'ua' });

  it('finds a live session and nothing once it is revoked', async () => {
    const s = await newSession();
    expect(await q.findActiveStudioSession(s.id)).toMatchObject({
      id: s.id,
      userId: await uid('octocat'),
    });
    expect(await q.revokeStudioSession(s.id, await uid('octocat'))).toBe(true);
    expect(await q.findActiveStudioSession(s.id)).toBeUndefined();
    // revoking twice reports nothing to revoke
    expect(await q.revokeStudioSession(s.id, await uid('octocat'))).toBe(false);
  });

  it('records activity at most once in five minutes', async () => {
    const s = await newSession();
    expect(s.lastSeenAt).toBeNull();
    await q.markStudioSessionSeen(s.id);
    const first = (await q.findActiveStudioSession(s.id))!.lastSeenAt;
    expect(first).toBeInstanceOf(Date);
    await q.markStudioSessionSeen(s.id);
    expect((await q.findActiveStudioSession(s.id))!.lastSeenAt!.getTime()).toBe(first!.getTime());

    await tdb.sql`update studio_sessions set last_seen_at = now() - interval '301 seconds' where id = ${s.id}`;
    await q.markStudioSessionSeen(s.id);
    expect((await q.findActiveStudioSession(s.id))!.lastSeenAt!.getTime()).toBeGreaterThan(
      first!.getTime(),
    );
    const [listed] = await q.listActiveStudioSessions(await uid('octocat'));
    expect(listed.lastSeenAt).toBeInstanceOf(Date);
  });

  it('does not find an expired session', async () => {
    const s = await newSession('octocat', new Date(Date.now() - 1000));
    expect(await q.findActiveStudioSession(s.id)).toBeUndefined();
  });

  it("refuses to revoke another account's session", async () => {
    const s = await newSession('alice');
    expect(await q.revokeStudioSession(s.id, await uid('octocat'))).toBe(false);
    expect(await q.findActiveStudioSession(s.id)).toBeDefined();
  });

  it('lists only live sessions of the account, newest first', async () => {
    const older = await newSession();
    const newer = await newSession();
    const revoked = await newSession();
    await q.revokeStudioSession(revoked.id, await uid('octocat'));
    await newSession('octocat', new Date(Date.now() - 1000));
    await newSession('alice');
    const rows = await q.listActiveStudioSessions(await uid('octocat'));
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it('revokes every live session of an account and no one else', async () => {
    await newSession();
    await newSession();
    const alice = await newSession('alice');
    expect(await q.revokeAllStudioSessions(await uid('octocat'))).toBe(2);
    expect(await q.listActiveStudioSessions(await uid('octocat'))).toEqual([]);
    expect(await q.findActiveStudioSession(alice.id)).toBeDefined();
  });

  it('prunes ended sessions older than the cutoff and keeps the rest', async () => {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const longExpired = await newSession('octocat', new Date(Date.now() - 48 * 3600_000));
    const justExpired = await newSession('octocat', new Date(Date.now() - 1000));
    const live = await newSession();
    const oldRevoked = await newSession();
    await tdb.sql`update studio_sessions set revoked_at = now() - interval '2 days' where id = ${oldRevoked.id}`;
    const otherLogin = await newSession('alice', new Date(Date.now() - 48 * 3600_000));

    await q.pruneStudioSessions(await uid('octocat'), cutoff);
    const ids = (await tdb.sql`select id from studio_sessions`).map((r) => r.id);
    expect(ids).not.toContain(longExpired.id);
    expect(ids).not.toContain(oldRevoked.id);
    expect(ids).toEqual(expect.arrayContaining([justExpired.id, live.id, otherLogin.id]));
  });

  it('prunes ended sessions of every account, for accounts that never sign in again', async () => {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    const longExpired = await newSession('octocat', new Date(Date.now() - 48 * 3600_000));
    const otherLogin = await newSession('alice', new Date(Date.now() - 48 * 3600_000));
    const oldRevoked = await newSession('bob');
    await tdb.sql`update studio_sessions set revoked_at = now() - interval '2 days' where id = ${oldRevoked.id}`;
    const justExpired = await newSession('carol', new Date(Date.now() - 1000));
    const recentlyRevoked = await newSession('dave');
    await q.revokeStudioSession(recentlyRevoked.id, await uid('dave'));
    const live = await newSession('erin');

    expect(await q.pruneEndedStudioSessions(cutoff)).toBe(3);
    const ids = (await tdb.sql`select id from studio_sessions`).map((r) => r.id);
    expect(ids.sort()).toEqual([justExpired.id, recentlyRevoked.id, live.id].sort());
    expect(ids).not.toContain(longExpired.id);
    expect(ids).not.toContain(otherLogin.id);
  });

  it('ends the sessions of an account when the account is removed', async () => {
    const s = await newSession();
    await tdb.sql`delete from users where id = ${await uid('octocat')}`;
    expect(await q.findActiveStudioSession(s.id)).toBeUndefined();
  });
});

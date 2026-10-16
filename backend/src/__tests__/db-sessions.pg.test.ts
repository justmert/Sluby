import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as SessionQueries from '../db/queries/sessions.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('studio session queries (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof SessionQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    q = await import('../db/queries/sessions.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  const inAnHour = () => new Date(Date.now() + 3600_000);
  const newSession = (login = 'octocat', expiresAt = inAnHour()) =>
    q.createStudioSession({ login, expiresAt, userAgent: 'ua' });

  it('finds a live session and nothing once it is revoked', async () => {
    const s = await newSession();
    expect(await q.findActiveStudioSession(s.id)).toMatchObject({ id: s.id, login: 'octocat' });
    expect(await q.revokeStudioSession(s.id, 'octocat')).toBe(true);
    expect(await q.findActiveStudioSession(s.id)).toBeUndefined();
    // revoking twice reports nothing to revoke
    expect(await q.revokeStudioSession(s.id, 'octocat')).toBe(false);
  });

  it('does not find an expired session', async () => {
    const s = await newSession('octocat', new Date(Date.now() - 1000));
    expect(await q.findActiveStudioSession(s.id)).toBeUndefined();
  });

  it("refuses to revoke another login's session", async () => {
    const s = await newSession('alice');
    expect(await q.revokeStudioSession(s.id, 'octocat')).toBe(false);
    expect(await q.findActiveStudioSession(s.id)).toBeDefined();
  });

  it('lists only live sessions of the login, newest first', async () => {
    const older = await newSession();
    const newer = await newSession();
    const revoked = await newSession();
    await q.revokeStudioSession(revoked.id, 'octocat');
    await newSession('octocat', new Date(Date.now() - 1000));
    await newSession('alice');
    const rows = await q.listActiveStudioSessions('octocat');
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it('revokes every live session of a login and no one else', async () => {
    await newSession();
    await newSession();
    const alice = await newSession('alice');
    expect(await q.revokeAllStudioSessions('octocat')).toBe(2);
    expect(await q.listActiveStudioSessions('octocat')).toEqual([]);
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

    await q.pruneStudioSessions('octocat', cutoff);
    const ids = (await tdb.sql`select id from studio_sessions`).map((r) => r.id);
    expect(ids).not.toContain(longExpired.id);
    expect(ids).not.toContain(oldRevoked.id);
    expect(ids).toEqual(expect.arrayContaining([justExpired.id, live.id, otherLogin.id]));
  });
});

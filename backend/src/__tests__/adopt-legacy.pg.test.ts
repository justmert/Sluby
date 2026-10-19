import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AdoptLegacy from '../api/auth/adopt-legacy.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('adopting the old access settings (postgres)', () => {
  let tdb: TestDatabase;
  let adopt: typeof AdoptLegacy;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    adopt = await import('../api/auth/adopt-legacy.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  /** An account from before membership: a github identity and a live session. */
  async function githubAccount(subject: string, login: string) {
    const [user] = await tdb.sql`
      insert into users (display_name) values (${login}) returning id`;
    const [identity] = await tdb.sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${user.id}, 'github', ${subject}, ${login}) returning id`;
    await tdb.sql`
      insert into studio_sessions (user_id, identity_id, expires_at)
      values (${user.id}, ${identity.id}, now() + interval '1 day')`;
    return user.id as string;
  }

  async function state(userId: string) {
    const [row] = await tdb.sql<{ role: string; disabled_at: Date | null }[]>`
      select role, disabled_at from users where id = ${userId}`;
    const [{ live }] = await tdb.sql<{ live: number }[]>`
      select count(*)::int as live from studio_sessions
      where user_id = ${userId} and revoked_at is null`;
    return { role: row.role, removed: row.disabled_at !== null, liveSessions: live };
  }

  async function adoptedRecord() {
    const rows = await tdb.sql<{ value: unknown }[]>`
      select value from instance_meta where key = 'legacy_access_adopted'`;
    return rows[0]?.value;
  }

  it('removes the github accounts the allowlist refuses and keeps the rest', async () => {
    const alice = await githubAccount('1', 'alice');
    const bob = await githubAccount('2', 'bob');
    // carol renamed since her handle entry pinned her account
    const carol = await githubAccount('3', 'carol-renamed');
    await tdb.sql`insert into allowlist_pins (provider, entry, subject) values ('github', 'carol', '3')`;
    // dave holds the freed handle "erin", which is pinned to someone else
    const dave = await githubAccount('4', 'erin');
    await tdb.sql`insert into allowlist_pins (provider, entry, subject) values ('github', 'erin', '99')`;
    const frank = await githubAccount('6', 'frank');

    const outcome = await adopt.adoptLegacyAccess({
      githubAllowedUsers: 'Alice, carol, erin, id:6',
      operatorUsers: '',
    });

    expect(outcome).toEqual({ status: 'adopted', removed: 2, promoted: 0 });
    expect(await state(alice)).toEqual({ role: 'member', removed: false, liveSessions: 1 });
    expect(await state(bob)).toEqual({ role: 'member', removed: true, liveSessions: 0 });
    expect(await state(carol)).toEqual({ role: 'member', removed: false, liveSessions: 1 });
    expect(await state(dave)).toEqual({ role: 'member', removed: true, liveSessions: 0 });
    expect(await state(frank)).toEqual({ role: 'member', removed: false, liveSessions: 1 });
    expect(await adoptedRecord()).toMatchObject({ removed: 2, promoted: 0 });
  });

  it('makes the accounts OPERATOR_USERS lists admins', async () => {
    const alice = await githubAccount('1', 'alice');
    const bob = await githubAccount('2', 'bob');
    const carol = await githubAccount('3', 'carol');

    const outcome = await adopt.adoptLegacyAccess({
      githubAllowedUsers: 'alice,bob',
      operatorUsers: 'github:alice, github:id:2, github:carol',
    });

    // carol is listed as an operator but the allowlist refuses her, so she is removed instead
    expect(outcome).toEqual({ status: 'adopted', removed: 1, promoted: 2 });
    expect(await state(alice)).toMatchObject({ role: 'admin', removed: false });
    expect(await state(bob)).toMatchObject({ role: 'admin', removed: false });
    expect(await state(carol)).toMatchObject({ role: 'member', removed: true });
  });

  it('removes nobody for an open allowlist, and still promotes operators', async () => {
    const alice = await githubAccount('1', 'alice');
    const bob = await githubAccount('2', 'bob');
    for (const open of ['*', '']) {
      await tdb.sql`delete from instance_meta`;
      await tdb.sql`update users set role = 'member'`;
      const outcome = await adopt.adoptLegacyAccess({
        githubAllowedUsers: open,
        operatorUsers: 'github:bob',
      });
      expect(outcome).toEqual({ status: 'adopted', removed: 0, promoted: 1 });
      expect(await state(alice)).toMatchObject({ role: 'member', removed: false });
      expect(await state(bob)).toMatchObject({ role: 'admin', removed: false });
    }
  });

  it('never touches the local dev account', async () => {
    const [dev] = await tdb.sql`
      insert into users (display_name, role) values ('Local developer', 'admin') returning id`;
    await tdb.sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${dev.id}, 'local', 'dev', 'dev')`;
    await adopt.adoptLegacyAccess({ githubAllowedUsers: 'alice', operatorUsers: '' });
    expect(await state(dev.id)).toEqual({ role: 'admin', removed: false, liveSessions: 0 });
  });

  it('runs once: a second run changes nothing, even with other settings', async () => {
    const alice = await githubAccount('1', 'alice');
    const bob = await githubAccount('2', 'bob');
    await adopt.adoptLegacyAccess({ githubAllowedUsers: 'alice,bob', operatorUsers: '' });
    const first = await adoptedRecord();

    const again = await adopt.adoptLegacyAccess({
      githubAllowedUsers: 'alice',
      operatorUsers: 'github:alice',
    });

    expect(again).toEqual({ status: 'already_adopted' });
    expect(await state(alice)).toMatchObject({ role: 'member', removed: false });
    expect(await state(bob)).toMatchObject({ role: 'member', removed: false });
    expect(await adoptedRecord()).toEqual(first);
  });

  it('with neither setting, records the adoption and changes nothing', async () => {
    const alice = await githubAccount('1', 'alice');
    const outcome = await adopt.adoptLegacyAccess({ githubAllowedUsers: '', operatorUsers: '' });
    expect(outcome).toEqual({ status: 'adopted', removed: 0, promoted: 0 });
    expect(await state(alice)).toEqual({ role: 'member', removed: false, liveSessions: 1 });
    expect(await adoptedRecord()).toMatchObject({ removed: 0, promoted: 0 });
  });

  it('runs once when two processes start together', async () => {
    await githubAccount('1', 'alice');
    await githubAccount('2', 'bob');
    const results = await Promise.all([
      adopt.adoptLegacyAccess({ githubAllowedUsers: 'alice', operatorUsers: '' }),
      adopt.adoptLegacyAccess({ githubAllowedUsers: 'alice', operatorUsers: '' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['adopted', 'already_adopted']);
  });
});

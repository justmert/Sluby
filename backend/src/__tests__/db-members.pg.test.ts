import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as MemberQueries from '../db/queries/members.js';
import type * as InviteQueries from '../db/queries/invites.js';
import type * as AccountQueries from '../db/queries/accounts.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('members and invites (postgres)', () => {
  let tdb: TestDatabase;
  let members: typeof MemberQueries;
  let invites: typeof InviteQueries;
  let accounts: typeof AccountQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    members = await import('../db/queries/members.js');
    invites = await import('../db/queries/invites.js');
    accounts = await import('../db/queries/accounts.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  async function member(
    login: string,
    role: 'admin' | 'member' = 'member',
    provider = 'github',
  ): Promise<string> {
    const [user] = await tdb.sql`
      insert into users (display_name, role) values (${login}, ${role}) returning id`;
    const [identity] = await tdb.sql`
      insert into user_identities (user_id, provider, subject, username, last_sign_in_at)
      values (${user.id}, ${provider}, ${`${provider}-${login}`}, ${login}, now() - interval '1 hour')
      returning id`;
    await tdb.sql`
      insert into studio_sessions (user_id, identity_id, expires_at)
      values (${user.id}, ${identity.id}, now() + interval '1 day')`;
    return user.id;
  }

  async function liveSessions(userId: string) {
    const [{ n }] = await tdb.sql<{ n: number }[]>`
      select count(*)::int as n from studio_sessions where user_id = ${userId} and revoked_at is null`;
    return n;
  }

  it('lists every member with their sign-in methods and last sign-in, oldest first', async () => {
    const ada = await member('ada', 'admin');
    await tdb.sql`
      insert into user_identities (user_id, provider, subject, username, last_sign_in_at)
      values (${ada}, 'password', ${ada}, 'ada@example.com', now())`;
    const bob = await member('bob');
    await tdb.sql`update users set disabled_at = now() where id = ${bob}`;
    const [carol] = await tdb.sql`insert into users (display_name) values ('carol') returning id`;

    const list = await members.listMembers();
    expect(list.map((m) => m.id)).toEqual([ada, bob, carol.id]);
    expect(list[0]).toMatchObject({
      name: 'ada',
      role: 'admin',
      disabledAt: null,
      signIn: [
        { provider: 'github', username: 'ada' },
        { provider: 'password', username: 'ada@example.com' },
      ],
    });
    expect(Date.now() - list[0].lastSignInAt!.getTime()).toBeLessThan(60_000);
    expect(list[1].disabledAt).toBeInstanceOf(Date);
    expect(list[2]).toMatchObject({ signIn: [], lastSignInAt: null });
  });

  it('changes a role, but keeps the last admin who can sign in', async () => {
    const ada = await member('ada', 'admin');
    const bob = await member('bob');
    expect(await members.changeMemberRole(ada, 'member')).toBe('last_admin');
    expect(await members.changeMemberRole(bob, 'admin')).toMatchObject({ role: 'admin' });
    expect(await members.changeMemberRole(ada, 'member')).toMatchObject({ role: 'member' });
    expect(await members.changeMemberRole(bob, 'member')).toBe('last_admin');
    expect(await members.changeMemberRole('00000000-0000-4000-8000-000000000000', 'admin')).toBe(
      'not_found',
    );
  });

  it('does not count a removed admin or the local dev account as another admin', async () => {
    const ada = await member('ada', 'admin');
    const old = await member('old', 'admin');
    await tdb.sql`update users set disabled_at = now() where id = ${old}`;
    await member('dev', 'admin', 'local');
    expect(await members.changeMemberRole(ada, 'member')).toBe('last_admin');
    expect(await members.removeMember(ada)).toBe('last_admin');
    // the local account itself can go: it keeps nobody in
    const dev = (await members.listMembers()).find((m) => m.name === 'dev')!;
    expect(await members.removeMember(dev.id)).toMatchObject({ id: dev.id });
  });

  it('lets only one of two admins demote the other at the same time', async () => {
    const ada = await member('ada', 'admin');
    const bob = await member('bob', 'admin');
    const results = await Promise.all([
      members.changeMemberRole(ada, 'member'),
      members.removeMember(bob),
    ]);
    expect(results.filter((r) => r === 'last_admin')).toHaveLength(1);
    expect(await accounts.hasSignInAdmin()).toBe(true);
  });

  it('removes a member, ending their sessions and stopping their keys, and restores them', async () => {
    await member('ada', 'admin');
    const bob = await member('bob');
    const removed = await members.removeMember(bob);
    expect(removed).toMatchObject({ id: bob, disabledAt: expect.any(Date) });
    expect(await liveSessions(bob)).toBe(0);
    expect((await accounts.getAccount(bob))?.disabledAt).toBeInstanceOf(Date);

    const restored = await members.restoreMember(bob);
    expect(restored).toMatchObject({ id: bob, disabledAt: null, role: 'member' });
    expect(await members.restoreMember('00000000-0000-4000-8000-000000000000')).toBe('not_found');
    expect(await members.removeMember('00000000-0000-4000-8000-000000000000')).toBe('not_found');
  });

  it('creates, lists and revokes invites, listing only pending ones', async () => {
    const ada = await member('ada', 'admin');
    const week = new Date(Date.now() + 7 * 24 * 3600_000);
    const first = await invites.createInvite({
      tokenHash: 'h1',
      role: 'member',
      createdBy: ada,
      expiresAt: week,
    });
    const second = await invites.createInvite({
      tokenHash: 'h2',
      role: 'admin',
      createdBy: null,
      expiresAt: week,
    });
    await invites.createInvite({
      tokenHash: 'h3',
      role: 'member',
      createdBy: ada,
      expiresAt: new Date(Date.now() - 1000),
    });
    await invites.createInvite({
      tokenHash: 'h4',
      role: 'member',
      createdBy: ada,
      expiresAt: week,
    });
    await tdb.sql`update invites set used_at = now() where token_hash = 'h4'`;

    const list = await invites.listPendingInvites();
    expect(list).toEqual([
      {
        id: second.id,
        role: 'admin',
        createdAt: second.createdAt,
        expiresAt: second.expiresAt,
        createdBy: null,
      },
      {
        id: first.id,
        role: 'member',
        createdAt: first.createdAt,
        expiresAt: first.expiresAt,
        createdBy: { id: ada, name: 'ada' },
      },
    ]);

    expect(await invites.revokeInvite(first.id)).toBe(true);
    expect(await invites.revokeInvite(first.id)).toBe(false);
    expect((await invites.listPendingInvites()).map((i) => i.id)).toEqual([second.id]);
    expect((await invites.findLink('h1'))?.revokedAt).toBeInstanceOf(Date);
  });

  it('creates a reset link only for a member that exists', async () => {
    const ada = await member('ada', 'admin');
    const bob = await member('bob');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const link = await invites.createResetLink({
      tokenHash: 'r1',
      userId: bob,
      createdBy: ada,
      expiresAt,
    });
    expect(link).toMatchObject({ id: expect.any(String), expiresAt });
    expect(await invites.findLink('r1')).toMatchObject({ kind: 'reset', userId: bob });
    expect(
      await invites.createResetLink({
        tokenHash: 'r2',
        userId: '00000000-0000-4000-8000-000000000000',
        createdBy: ada,
        expiresAt,
      }),
    ).toBeNull();
    // reset links are not invites
    expect(await invites.listPendingInvites()).toEqual([]);
  });
});

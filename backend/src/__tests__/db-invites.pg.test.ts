import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AccountQueries from '../db/queries/accounts.js';
import type * as InviteQueries from '../db/queries/invites.js';
import type * as SessionQueries from '../db/queries/sessions.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('password accounts, setup and links (postgres)', () => {
  let tdb: TestDatabase;
  let accounts: typeof AccountQueries;
  let links: typeof InviteQueries;
  let sessions: typeof SessionQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    accounts = await import('../db/queries/accounts.js');
    links = await import('../db/queries/invites.js');
    sessions = await import('../db/queries/sessions.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  beforeEach(async () => {
    await tdb.truncate();
  });

  async function githubMember(subject: string, login: string, role = 'member') {
    const [user] = await tdb.sql`
      insert into users (display_name, role) values (${login}, ${role}) returning id`;
    const [identity] = await tdb.sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${user.id}, 'github', ${subject}, ${login}) returning id`;
    return { userId: user.id as string, identityId: identity.id as string };
  }

  async function link(
    hash: string,
    fields: {
      kind?: 'invite' | 'reset';
      role?: 'admin' | 'member' | null;
      userId?: string | null;
      expiresIn?: string;
      used?: boolean;
      revoked?: boolean;
    } = {},
  ) {
    const kind = fields.kind ?? 'invite';
    const role = fields.role === undefined ? (kind === 'invite' ? 'member' : null) : fields.role;
    await tdb.sql`
      insert into invites (token_hash, kind, role, user_id, expires_at, used_at, revoked_at)
      values (
        ${hash}, ${kind}, ${role}, ${fields.userId ?? null},
        now() + ${fields.expiresIn ?? '7 days'}::interval,
        ${fields.used ? new Date() : null}, ${fields.revoked ? new Date() : null}
      )`;
  }

  async function liveSessions(userId: string) {
    const [{ n }] = await tdb.sql<{ n: number }[]>`
      select count(*)::int as n from studio_sessions where user_id = ${userId} and revoked_at is null`;
    return n;
  }

  async function session(userId: string, identityId: string) {
    return sessions.createStudioSession({
      userId,
      identityId,
      expiresAt: new Date(Date.now() + 3600_000),
      userAgent: null,
    });
  }

  const person = { name: 'Ada', email: 'ada@example.com', passwordHash: 'scrypt$hash-1' };

  describe('setup', () => {
    it('makes the first admin with a password identity, and refuses a second', async () => {
      expect(await accounts.hasSignInAdmin()).toBe(false);
      const created = await accounts.createFirstAdmin(person);
      expect(created).toMatchObject({ status: 'created' });
      expect(await accounts.hasSignInAdmin()).toBe(true);
      const account = await accounts.getAccount((created as { userId: string }).userId);
      expect(account).toMatchObject({ displayName: 'Ada', role: 'admin', disabledAt: null });
      expect(account!.identities).toEqual([
        expect.objectContaining({ provider: 'password', username: 'ada@example.com' }),
      ]);
      expect(await accounts.createFirstAdmin({ ...person, email: 'other@example.com' })).toEqual({
        status: 'admin_exists',
      });
    });

    it('lets only one of two concurrent setups through', async () => {
      const results = await Promise.all([
        accounts.createFirstAdmin(person),
        accounts.createFirstAdmin({ ...person, email: 'b@example.com' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['admin_exists', 'created']);
    });

    it('is still needed while the only admins are removed or the local dev account', async () => {
      const removed = await githubMember('1', 'old-admin', 'admin');
      await tdb.sql`update users set disabled_at = now() where id = ${removed.userId}`;
      const [dev] = await tdb.sql`
        insert into users (display_name, role) values ('Local developer', 'admin') returning id`;
      await tdb.sql`
        insert into user_identities (user_id, provider, subject, username)
        values (${dev.id}, 'local', 'dev', 'dev')`;
      await githubMember('2', 'member');
      expect(await accounts.hasSignInAdmin()).toBe(false);
      expect(await accounts.createFirstAdmin(person)).toMatchObject({ status: 'created' });
    });
  });

  describe('password accounts', () => {
    it('finds an account by its email, with its removal state', async () => {
      const { userId, identityId } = (await accounts.createFirstAdmin(person)) as {
        userId: string;
        identityId: string;
      };
      expect(await accounts.findPasswordAccount('ada@example.com')).toEqual({
        userId,
        identityId,
        passwordHash: 'scrypt$hash-1',
        disabled: false,
      });
      expect(await accounts.findPasswordAccount('nobody@example.com')).toBeNull();
      await tdb.sql`update users set disabled_at = now() where id = ${userId}`;
      expect((await accounts.findPasswordAccount('ada@example.com'))?.disabled).toBe(true);
    });

    it('changes a password and records sign-ins', async () => {
      const { userId, identityId } = (await accounts.createFirstAdmin(person)) as {
        userId: string;
        identityId: string;
      };
      await tdb.sql`update user_identities set last_sign_in_at = now() - interval '1 day'`;
      await accounts.recordSignIn(identityId);
      const [row] = await tdb.sql`select last_sign_in_at from user_identities`;
      expect(Date.now() - row.last_sign_in_at.getTime()).toBeLessThan(60_000);

      await accounts.setPassword(userId, 'scrypt$hash-2');
      expect(await accounts.getPasswordCredential(userId)).toEqual({
        email: 'ada@example.com',
        passwordHash: 'scrypt$hash-2',
      });
      const other = await githubMember('1', 'octocat');
      expect(await accounts.getPasswordCredential(other.userId)).toBeNull();
    });

    it('ends every session of an account but one', async () => {
      const m = await githubMember('1', 'octocat');
      const keep = await session(m.userId, m.identityId);
      await session(m.userId, m.identityId);
      await session(m.userId, m.identityId);
      expect(await sessions.revokeOtherStudioSessions(m.userId, keep.id)).toBe(2);
      expect(await sessions.findActiveStudioSession(keep.id)).toBeDefined();
      expect(await liveSessions(m.userId)).toBe(1);
    });
  });

  describe('linking an identity', () => {
    it('adds a github identity to an account, and refuses one another account has', async () => {
      const ada = (await accounts.createFirstAdmin(person)) as { userId: string };
      const linked = await accounts.linkIdentity(ada.userId, {
        provider: 'github',
        subject: '7',
        username: 'ada-gh',
      });
      expect(linked).toMatchObject({ status: 'linked' });
      expect(
        await accounts.signInIdentity({
          provider: 'github',
          subject: '7',
          username: 'ada-gh',
          displayName: 'Ada',
        }),
      ).toMatchObject({ status: 'signed_in', userId: ada.userId });

      // linking it again only refreshes the handle
      expect(
        await accounts.linkIdentity(ada.userId, {
          provider: 'github',
          subject: '7',
          username: 'a',
        }),
      ).toEqual(linked);

      const bob = await githubMember('8', 'bob');
      expect(
        await accounts.linkIdentity(ada.userId, {
          provider: 'github',
          subject: '8',
          username: 'b',
        }),
      ).toEqual({ status: 'already_linked' });
      const [{ n }] = await tdb.sql`
        select count(*)::int as n from user_identities where user_id = ${bob.userId}`;
      expect(n).toBe(1);
    });
  });

  describe('invites', () => {
    it('finds a link with what its page shows', async () => {
      await link('h-invite', { role: 'admin' });
      expect(await links.findLink('h-invite')).toMatchObject({
        kind: 'invite',
        role: 'admin',
        userId: null,
        email: null,
        userDisabled: false,
        usedAt: null,
        revokedAt: null,
      });
      expect(await links.findLink('unknown')).toBeNull();
    });

    it("makes a member with the invite's role and marks the invite used", async () => {
      await link('h1', { role: 'admin' });
      const joined = await links.acceptInvite('h1', person);
      expect(joined).toMatchObject({ status: 'joined' });
      const account = await accounts.getAccount((joined as { userId: string }).userId);
      expect(account).toMatchObject({ displayName: 'Ada', role: 'admin' });
      const [row] = await tdb.sql`select used_at from invites where token_hash = 'h1'`;
      expect(row.used_at).toBeInstanceOf(Date);
      expect(await links.acceptInvite('h1', { ...person, email: 'x@example.com' })).toEqual({
        status: 'gone',
        reason: 'used',
      });
    });

    it('refuses an expired, revoked, unknown or reset link', async () => {
      await link('expired', { expiresIn: '-1 minute' });
      await link('revoked', { revoked: true });
      const m = await githubMember('1', 'octocat');
      await link('reset', { kind: 'reset', userId: m.userId });
      expect(await links.acceptInvite('expired', person)).toEqual({
        status: 'gone',
        reason: 'expired',
      });
      expect(await links.acceptInvite('revoked', person)).toEqual({
        status: 'gone',
        reason: 'revoked',
      });
      expect(await links.acceptInvite('nope', person)).toEqual({ status: 'not_found' });
      expect(await links.acceptInvite('reset', person)).toEqual({ status: 'not_found' });
      const [{ n }] = await tdb.sql`select count(*)::int as n from password_credentials`;
      expect(n).toBe(0);
    });

    it('refuses an email another account signs in with, and leaves the invite usable', async () => {
      await accounts.createFirstAdmin(person);
      await link('h1');
      expect(
        await links.acceptInvite('h1', { ...person, email: 'ADA@example.com'.toLowerCase() }),
      ).toEqual({
        status: 'email_taken',
      });
      const [row] = await tdb.sql`select used_at from invites where token_hash = 'h1'`;
      expect(row.used_at).toBeNull();
      const [{ n }] = await tdb.sql`select count(*)::int as n from users`;
      expect(n).toBe(1);
    });

    it('lets only one of two browsers use an invite', async () => {
      await link('h1');
      const results = await Promise.all([
        links.acceptInvite('h1', person),
        links.acceptInvite('h1', { ...person, email: 'b@example.com' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['gone', 'joined']);
    });

    const week = () => new Date(Date.now() + 7 * 24 * 3600_000);
    const as = (n: number) => ({ ...person, email: `p${n}@example.com` });

    it('lets as many people join as the invite allows, counting each, then refuses', async () => {
      await links.createInvite({
        tokenHash: 'h3',
        role: 'member',
        maxUses: 3,
        createdBy: null,
        expiresAt: week(),
      });
      for (const n of [1, 2]) {
        expect(await links.acceptInvite('h3', as(n))).toMatchObject({ status: 'joined' });
        const [pending] = await links.listPendingInvites();
        expect(pending).toMatchObject({ maxUses: 3, uses: n });
      }
      expect(await links.acceptInvite('h3', as(3))).toMatchObject({ status: 'joined' });
      expect(await links.listPendingInvites()).toEqual([]);
      expect(await links.acceptInvite('h3', as(4))).toEqual({ status: 'gone', reason: 'used' });
      const [row] = await tdb.sql`select use_count, used_at from invites where token_hash = 'h3'`;
      expect(row.use_count).toBe(3);
      expect(row.used_at).toBeInstanceOf(Date);
      const [{ n }] = await tdb.sql`select count(*)::int as n from users`;
      expect(n).toBe(3);
    });

    it('lets anyone join an invite without a limit until it is revoked, keeping who joined', async () => {
      await links.createInvite({
        tokenHash: 'open',
        role: 'member',
        maxUses: null,
        createdBy: null,
        expiresAt: week(),
      });
      for (const n of [1, 2, 3, 4, 5]) {
        expect(await links.acceptInvite('open', as(n))).toMatchObject({ status: 'joined' });
      }
      const [pending] = await links.listPendingInvites();
      expect(pending).toMatchObject({ maxUses: null, uses: 5 });
      expect((await links.findLink('open'))?.usedAt).toBeNull();

      expect(await links.revokeInvite(pending.id)).toBe(true);
      expect(await links.acceptInvite('open', as(6))).toEqual({
        status: 'gone',
        reason: 'revoked',
      });
      const [{ n }] = await tdb.sql`
        select count(*)::int as n from users where role = 'member' and disabled_at is null`;
      expect(n).toBe(5);
    });

    it('lets two browsers take the last two places of an invite, and no third', async () => {
      await links.createInvite({
        tokenHash: 'two',
        role: 'member',
        maxUses: 2,
        createdBy: null,
        expiresAt: week(),
      });
      const results = await Promise.all([1, 2, 3].map((n) => links.acceptInvite('two', as(n))));
      expect(results.map((r) => r.status).sort()).toEqual(['gone', 'joined', 'joined']);
    });

    it('stores no admin invite or reset link that works more than once', async () => {
      for (const maxUses of [2, null]) {
        await expect(
          links.createInvite({
            tokenHash: `admin-${maxUses}`,
            role: 'admin',
            maxUses,
            createdBy: null,
            expiresAt: week(),
          }),
        ).rejects.toThrow();
      }
      const m = await githubMember('1', 'octocat');
      await expect(
        tdb.sql`
          insert into invites (token_hash, kind, user_id, expires_at, max_uses)
          values ('reset-many', 'reset', ${m.userId}, now() + interval '1 day', 2)`,
      ).rejects.toThrow(/invites_multi_use_check/);
      await expect(
        tdb.sql`
          insert into invites (token_hash, kind, role, expires_at, max_uses)
          values ('zero', 'invite', 'member', now() + interval '1 day', 0)`,
      ).rejects.toThrow(/invites_max_uses_check/);
    });

    it('joins with a github identity, but not one that is already a member', async () => {
      await link('h1');
      const joined = await links.joinWithIdentity('h1', {
        provider: 'github',
        subject: '42',
        username: 'newbie',
        displayName: 'New Bie',
      });
      expect(joined).toMatchObject({ status: 'joined' });
      const account = await accounts.getAccount((joined as { userId: string }).userId);
      expect(account).toMatchObject({ displayName: 'New Bie', role: 'member' });
      expect(account!.identities).toEqual([
        expect.objectContaining({ provider: 'github', subject: '42', username: 'newbie' }),
      ]);

      await link('h2');
      await githubMember('1', 'octocat');
      expect(
        await links.joinWithIdentity('h2', {
          provider: 'github',
          subject: '1',
          username: 'octocat',
          displayName: 'octocat',
        }),
      ).toEqual({ status: 'already_linked' });
      const [row] = await tdb.sql`select used_at from invites where token_hash = 'h2'`;
      expect(row.used_at).toBeNull();
    });
  });

  describe('reset links', () => {
    it('replaces a password and ends every session of the member', async () => {
      const ada = (await accounts.createFirstAdmin(person)) as {
        userId: string;
        identityId: string;
      };
      await session(ada.userId, ada.identityId);
      await link('r1', { kind: 'reset', userId: ada.userId });
      expect(await links.findLink('r1')).toMatchObject({
        kind: 'reset',
        userId: ada.userId,
        email: 'ada@example.com',
      });

      const reset = await links.acceptReset('r1', { email: null, passwordHash: 'scrypt$new' });
      expect(reset).toEqual({ status: 'reset', userId: ada.userId, identityId: ada.identityId });
      expect((await accounts.getPasswordCredential(ada.userId))?.passwordHash).toBe('scrypt$new');
      expect(await liveSessions(ada.userId)).toBe(0);
      expect(await links.acceptReset('r1', { email: null, passwordHash: 'x' })).toEqual({
        status: 'gone',
        reason: 'used',
      });
    });

    it('gives a github member a first password under a new email', async () => {
      const m = await githubMember('1', 'octocat');
      await link('r1', { kind: 'reset', userId: m.userId });
      expect((await links.findLink('r1'))?.email).toBeNull();
      const reset = await links.acceptReset('r1', {
        email: 'octo@example.com',
        passwordHash: 'scrypt$first',
      });
      expect(reset).toMatchObject({ status: 'reset', userId: m.userId });
      expect(await accounts.findPasswordAccount('octo@example.com')).toMatchObject({
        userId: m.userId,
        passwordHash: 'scrypt$first',
      });
      const account = await accounts.getAccount(m.userId);
      expect(account!.identities.map((i) => i.provider).sort()).toEqual(['github', 'password']);
    });

    it('refuses an email another account has, a removed member, and an invite link', async () => {
      await accounts.createFirstAdmin(person);
      const m = await githubMember('1', 'octocat');
      await link('r1', { kind: 'reset', userId: m.userId });
      expect(
        await links.acceptReset('r1', { email: 'ada@example.com', passwordHash: 'x' }),
      ).toEqual({ status: 'email_taken' });

      await tdb.sql`update users set disabled_at = now() where id = ${m.userId}`;
      expect((await links.findLink('r1'))?.userDisabled).toBe(true);
      expect(await links.acceptReset('r1', { email: 'o@example.com', passwordHash: 'x' })).toEqual({
        status: 'disabled',
      });

      await link('i1');
      expect(await links.acceptReset('i1', { email: 'o@example.com', passwordHash: 'x' })).toEqual({
        status: 'not_found',
      });
    });
  });
});

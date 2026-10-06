import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { Allowlist } from '../api/auth/allowlist.js';
import type * as AccountQueries from '../db/queries/accounts.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('accounts, identities and legacy claims (postgres)', () => {
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

  const open = new Allowlist('', (h) => h.toLowerCase());

  const signIn = (
    subject: string,
    login: string,
    allowlist: Allowlist = open,
  ): Promise<AccountQueries.SignInResult> =>
    q.signInIdentity({
      provider: 'github',
      subject,
      username: login,
      displayName: login,
      legacyAddress: `github:${login.toLowerCase()}`,
      decide: (pins) => allowlist.atSignIn(subject, login, pins),
    });

  const signedIn = async (subject: string, login: string, allowlist?: Allowlist) => {
    const r = await signIn(subject, login, allowlist);
    if (r.status !== 'signed_in') throw new Error('refused');
    return r;
  };

  /** One row in every table that stores an owner, all owned by `owner`. */
  async function seedOwned(owner: string, tag: string) {
    const sql = tdb.sql;
    const [asset] = await sql`
      insert into video_assets (title, creator_address) values (${`asset ${tag}`}, ${owner})
      returning id`;
    await sql`
      insert into api_keys (key_hash, name, creator_address)
      values (${`hash-${tag}`}, ${`key ${tag}`}, ${owner})`;
    await sql`
      insert into webhook_endpoints (creator_address, url, secret)
      values (${owner}, ${`https://hooks.example/${tag}`}, 'secret')`;
    await sql`
      insert into upload_sessions (upload_url, file_path, file_size, metadata)
      values ('u', ${`/uploads/${tag}`}, 1, ${sql.json({ creatorAddress: owner, title: tag })})`;
    return asset.id as string;
  }

  async function owners() {
    const sql = tdb.sql;
    const rows = await sql<{ t: string; owner: string }[]>`
      select 'asset' as t, creator_address as owner from video_assets
      union all select 'key', creator_address from api_keys
      union all select 'webhook', creator_address from webhook_endpoints
      union all select 'upload', metadata->>'creatorAddress' from upload_sessions
      order by 1, 2`;
    return rows.map((r) => `${r.t}:${r.owner}`);
  }

  it('creates an account keyed on the numeric id and claims the github:<login> data', async () => {
    await seedOwned('github:octocat', 'mine');
    await seedOwned('github:someone-else', 'theirs');
    const r = await signedIn('1', 'Octocat');

    const me = `user:${r.userId}`;
    expect(await owners()).toEqual(
      [
        `asset:${me}`,
        'asset:github:someone-else',
        `key:${me}`,
        'key:github:someone-else',
        `upload:${me}`,
        'upload:github:someone-else',
        `webhook:${me}`,
        'webhook:github:someone-else',
      ].sort(),
    );
    // the rest of the upload session's metadata is kept
    const [meta] =
      await tdb.sql`select metadata from upload_sessions where file_path = '/uploads/mine'`;
    expect(meta.metadata).toEqual({ creatorAddress: me, title: 'mine' });
    expect(await q.findLegacyClaim('github:octocat')).toBe(r.userId);

    const account = await q.getAccount(r.userId);
    expect(account).toEqual({
      id: r.userId,
      displayName: 'Octocat',
      identities: [
        {
          id: r.identityId,
          provider: 'github',
          subject: '1',
          username: 'Octocat',
          pinnedEntries: [],
        },
      ],
    });
  });

  it('signs the same id into the same account, updating its handle and name', async () => {
    const first = await signedIn('1', 'octocat');
    const again = await signedIn('1', 'octocat-renamed');
    expect(again.userId).toBe(first.userId);
    expect(again.identityId).toBe(first.identityId);
    const [row] = await tdb.sql`select username from user_identities`;
    expect(row.username).toBe('octocat-renamed');
    const [{ n }] = await tdb.sql`select count(*)::int as n from users`;
    expect(n).toBe(1);
  });

  it('never lets a second id claim a login that was claimed (a recycled name)', async () => {
    await seedOwned('github:octocat', 'a');
    const original = await signedIn('1', 'octocat');
    // the original renamed, someone registered the freed login, and old-version
    // data somehow still names it
    await seedOwned('github:octocat', 'late');
    const newcomer = await signedIn('99', 'octocat');
    expect(newcomer.userId).not.toBe(original.userId);
    expect(await q.findLegacyClaim('github:octocat')).toBe(original.userId);
    const theirs = (await owners()).filter((o) => o.includes(newcomer.userId));
    expect(theirs).toEqual([]);
  });

  it('does not claim legacy data for an account that already exists (it renamed into the login)', async () => {
    const existing = await signedIn('1', 'first-login');
    await seedOwned('github:second-login', 'x');
    await signedIn('1', 'second-login');
    expect(await q.findLegacyClaim('github:second-login')).toBeNull();
    expect((await owners()).every((o) => !o.includes(existing.userId))).toBe(true);
  });

  it('moves rows written under a claimed address after the claim at the next sign-in', async () => {
    const r = await signedIn('1', 'octocat');
    // a request that loaded the old key before the claim and wrote after it
    await seedOwned('github:octocat', 'straggler');
    await signedIn('1', 'octocat');
    expect((await owners()).every((o) => o.endsWith(`user:${r.userId}`))).toBe(true);
  });

  it('creates one account and claims once when the same id signs in many times at once', async () => {
    await seedOwned('github:octocat', 'race');
    const results = await Promise.all(Array.from({ length: 8 }, () => signedIn('1', 'octocat')));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    const [{ users }] = await tdb.sql`select count(*)::int as users from users`;
    const [{ ids }] = await tdb.sql`select count(*)::int as ids from user_identities`;
    expect([users, ids]).toEqual([1, 1]);
    expect((await owners()).every((o) => o.endsWith(`user:${results[0].userId}`))).toBe(true);
  });

  it('gives a contested legacy address to exactly one of two ids signing in at once', async () => {
    await seedOwned('github:octocat', 'contested');
    const [a, b] = await Promise.all([signedIn('1', 'octocat'), signedIn('2', 'octocat')]);
    const claimant = await q.findLegacyClaim('github:octocat');
    expect([a.userId, b.userId]).toContain(claimant);
    expect(new Set(await owners())).toEqual(
      new Set([
        `asset:user:${claimant}`,
        `key:user:${claimant}`,
        `upload:user:${claimant}`,
        `webhook:user:${claimant}`,
      ]),
    );
  });

  it('records nothing for a sign-in the allowlist refuses', async () => {
    await seedOwned('github:mallory', 'm');
    const r = await signIn('7', 'mallory', new Allowlist('alice', (h) => h.toLowerCase()));
    expect(r).toEqual({ status: 'refused' });
    const [{ n }] = await tdb.sql`select count(*)::int as n from users`;
    expect(n).toBe(0);
    expect(await q.findLegacyClaim('github:mallory')).toBeNull();
    expect(await owners()).toContain('asset:github:mallory');
  });

  it('pins a login entry to the first id and refuses the next owner of that login', async () => {
    const list = new Allowlist('alice', (h) => h.toLowerCase());
    const alice = await signedIn('1', 'Alice', list);
    expect(await q.isAllowlistEntryPinned('github', 'alice')).toBe(true);
    expect((await q.getAccount(alice.userId))?.identities[0].pinnedEntries).toEqual(['alice']);

    expect(await signIn('2', 'alice', list)).toEqual({ status: 'refused' });
    // the pinned account still gets in under a new name
    expect((await signIn('1', 'alice-renamed', list)).status).toBe('signed_in');
  });

  it('lets only one of two ids racing for an unpinned entry take it', async () => {
    const list = new Allowlist('alice', (h) => h.toLowerCase());
    const results = await Promise.all([signIn('1', 'alice', list), signIn('2', 'alice', list)]);
    expect(results.map((r) => r.status).sort()).toEqual(['refused', 'signed_in']);
    const [pin] = await tdb.sql`select subject from allowlist_pins where entry = 'alice'`;
    const winner = results.findIndex((r) => r.status === 'signed_in');
    expect(pin.subject).toBe(String(winner + 1));
  });

  it('makes one local dev account however often and concurrently it is asked for', async () => {
    const dev = {
      provider: 'local',
      subject: 'dev',
      username: 'dev',
      displayName: 'Local developer',
    };
    const all = await Promise.all(Array.from({ length: 5 }, () => q.ensureIdentityAccount(dev)));
    expect(new Set(all.map((a) => a.userId)).size).toBe(1);
    expect(await q.ensureIdentityAccount(dev)).toEqual(all[0]);
  });

  it('returns null for an account that does not exist', async () => {
    expect(await q.getAccount('5c1e6a3d-8a7b-4f2c-9e1d-0b2a3c4d5e6f')).toBeNull();
  });
});

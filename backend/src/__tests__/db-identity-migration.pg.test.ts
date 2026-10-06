import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { Allowlist } from '../api/auth/allowlist.js';
import type * as AccountQueries from '../db/queries/accounts.js';
import type * as Database from '../config/database.js';

// a database at the last migration before accounts, filled the way the
// login-keyed versions wrote it, then upgraded
describe.skipIf(!hasTestDatabase)('upgrade to accounts and identities (postgres)', () => {
  let tdb: TestDatabase;
  let q: typeof AccountQueries;
  let database: typeof Database;
  const PLATFORM = `0x${'0'.repeat(64)}`;
  const OWNERS = ['github:alice', 'github:bob', 'github:dev', 'platform', PLATFORM];

  beforeAll(async () => {
    tdb = await createTestDatabase({ through: '0010_reconcile_inventory' });
    const sql = tdb.sql;

    for (const owner of OWNERS) {
      const tag = owner.replace(/\W/g, '-');
      for (let i = 0; i < 3; i++) {
        await sql`
          insert into video_assets (title, creator_address, status)
          values (${`${tag} ${i}`}, ${owner}, 'ready')`;
      }
      const [key] = await sql`
        insert into api_keys (key_hash, name, scopes, creator_address)
        values (${`hash-${tag}`}, ${`key ${tag}`}, ${['read', 'manage']}, ${owner})
        returning id`;
      const [hook] = await sql`
        insert into webhook_endpoints (creator_address, api_key_id, url, events, secret)
        values (${owner}, ${key.id}, ${`https://hooks.example/${tag}`}, ${['asset.ready']}, 's')
        returning id`;
      await sql`
        insert into webhook_deliveries (webhook_endpoint_id, event_type, payload, status_code, response_body)
        values (${hook.id}, 'asset.ready', ${sql.json({ event: 'asset.ready' })}, 404,
          '{"error":"Not Found","message":"Route POST /health not found"}')`;
      await sql`
        insert into upload_sessions (upload_url, file_path, file_size, metadata)
        values ('u', ${`/uploads/${tag}`}, 1, ${sql.json({ creatorAddress: owner, title: tag })})`;
    }
    // live sessions of the old shape, keyed on a login
    await sql`
      insert into studio_sessions (login, expires_at)
      values ('alice', now() + interval '1 day'), ('dev', now() + interval '1 day')`;

    await tdb.migrateToLatest();
    q = await import('../db/queries/accounts.js');
    database = await import('../config/database.js');
  }, 120_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  const ownerCounts = async () => {
    const rows = await tdb.sql<{ owner: string; n: number }[]>`
      select owner, count(*)::int as n from (
        select creator_address as owner from video_assets
        union all select creator_address from api_keys
        union all select creator_address from webhook_endpoints
        union all select metadata->>'creatorAddress' from upload_sessions
      ) o group by owner order by owner`;
    return Object.fromEntries(rows.map((r) => [r.owner, r.n]));
  };

  const devAccount = async () => {
    const [row] = await tdb.sql`
      select user_id from user_identities where provider = 'local' and subject = 'dev'`;
    return row?.user_id as string | undefined;
  };

  it('keeps every owned row, moving only the old AUTH_DISABLED identity', async () => {
    const dev = await devAccount();
    expect(dev).toBeDefined();
    // 3 assets, 1 key, 1 webhook and 1 upload session each
    expect(await ownerCounts()).toEqual({
      'github:alice': 6,
      'github:bob': 6,
      platform: 6,
      [PLATFORM]: 6,
      [`user:${dev}`]: 6,
    });
    const [{ n }] = await tdb.sql`select count(*)::int as n from video_assets`;
    expect(n).toBe(15);
  });

  it('claims github:dev for the local dev account, so no github user named dev can take it', async () => {
    const dev = await devAccount();
    expect(await q.findLegacyClaim('github:dev')).toBe(dev);
    const [user] = await tdb.sql`select display_name from users where id = ${dev!}`;
    expect(user.display_name).toBe('Local developer');

    const githubDev = await q.signInIdentity({
      provider: 'github',
      subject: '424242',
      username: 'dev',
      displayName: 'dev',
      legacyAddress: 'github:dev',
      decide: () => ({ allowed: true }),
    });
    expect(githubDev.status).toBe('signed_in');
    expect((await ownerCounts())[`user:${dev}`]).toBe(6);
    expect(await q.findLegacyClaim('github:dev')).toBe(dev);
  });

  it('ends the old login-keyed sessions', async () => {
    const [{ n }] = await tdb.sql`select count(*)::int as n from studio_sessions`;
    expect(n).toBe(0);
    const cols = await tdb.sql`
      select column_name from information_schema.columns where table_name = 'studio_sessions'`;
    expect(cols.map((c) => c.column_name)).not.toContain('login');
  });

  it('drops stored webhook response bodies and keeps the delivery rows', async () => {
    const cols = await tdb.sql`
      select column_name from information_schema.columns where table_name = 'webhook_deliveries'`;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('response_body');
    expect(names).toContain('error');
    const [{ n }] = await tdb.sql`select count(*)::int as n from webhook_deliveries`;
    expect(n).toBe(5);
  });

  it("hands alice's data to the account that signs in as alice, at its first sign-in", async () => {
    const list = new Allowlist('alice,bob', (h) => h.toLowerCase());
    const r = await q.signInIdentity({
      provider: 'github',
      subject: '1001',
      username: 'Alice',
      displayName: 'Alice A.',
      legacyAddress: 'github:alice',
      decide: (pins) => list.atSignIn('1001', 'Alice', pins),
    });
    if (r.status !== 'signed_in') throw new Error('refused');
    const counts = await ownerCounts();
    expect(counts[`user:${r.userId}`]).toBe(6);
    expect(counts['github:alice']).toBeUndefined();
    // bob has not signed in: his rows stay where they were, still reachable by his key
    expect(counts['github:bob']).toBe(6);
    expect(await q.isAllowlistEntryPinned('github', 'alice')).toBe(true);

    // the key alice made before the upgrade now belongs to her account
    const [key] =
      await tdb.sql`select creator_address from api_keys where key_hash = 'hash-github-alice'`;
    expect(key.creator_address).toBe(`user:${r.userId}`);
  });
});

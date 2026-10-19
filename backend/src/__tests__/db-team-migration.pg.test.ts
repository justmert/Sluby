import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';

// a database at the last migration with per-account ownership, filled with
// every owner shape older versions wrote, then upgraded to one workspace
describe.skipIf(!hasTestDatabase)('upgrade to one team workspace (postgres)', () => {
  let tdb: TestDatabase;
  let alice: string;
  let dev: string;
  let gone: string;
  const ZERO = `0x${'0'.repeat(64)}`;

  beforeAll(async () => {
    tdb = await createTestDatabase({ through: '0021_backfill_unreadable_not_retryable' });
    const sql = tdb.sql;

    [{ id: alice }] = await sql`insert into users (display_name) values ('alice') returning id`;
    await sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${alice}, 'github', '1001', 'alice')`;
    [{ id: dev }] = await sql`
      insert into users (display_name) values ('Local developer') returning id`;
    await sql`
      insert into user_identities (user_id, provider, subject, username)
      values (${dev}, 'local', 'dev', 'dev')`;
    await sql`insert into legacy_owner_claims (address, user_id) values ('github:dev', ${dev})`;
    await sql`
      insert into allowlist_pins (provider, entry, subject) values ('github', 'alice', '1001')`;
    // an owner address naming an account that no longer exists
    gone = '00000000-0000-4000-8000-000000000001';

    const owners = [
      `user:${alice}`,
      `user:${dev}`,
      `user:${gone}`,
      'github:octocat',
      'platform',
      ZERO,
    ];
    for (const owner of owners) {
      const tag = owner.replace(/\W/g, '-');
      await sql`
        insert into video_assets (title, creator_address, status)
        values (${tag}, ${owner}, 'ready')`;
      const [key] = await sql`
        insert into api_keys (key_hash, name, scopes, creator_address)
        values (${`hash-${tag}`}, ${tag}, ${['read']}, ${owner})
        returning id`;
      await sql`
        insert into webhook_endpoints (creator_address, api_key_id, url, events, secret)
        values (${owner}, ${key.id}, ${`https://hooks.example/${tag}`}, ${['asset.ready']}, 's')`;
      await sql`
        insert into upload_sessions (upload_url, file_path, file_size, metadata)
        values ('u', ${`/uploads/${tag}`}, 1, ${sql.json({ creatorAddress: owner, title: tag })})`;
    }
    // an upload session from before the owner was recorded in its metadata
    await sql`
      insert into upload_sessions (upload_url, file_path, file_size, metadata)
      values ('u', '/uploads/bare', 1, ${sql.json({ title: 'bare' })})`;

    await tdb.migrateToLatest();
  }, 120_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('gives every owned row to the workspace', async () => {
    const rows = await tdb.sql<{ owner: string; n: number }[]>`
      select owner, count(*)::int as n from (
        select creator_address as owner from video_assets
        union all select creator_address from api_keys
        union all select creator_address from webhook_endpoints
        union all select metadata->>'creatorAddress' from upload_sessions
          where metadata ? 'creatorAddress'
      ) o group by owner`;
    // 6 owners with an asset, a key, a webhook and an upload session each
    expect(rows).toEqual([{ owner: 'workspace', n: 24 }]);
    const [bare] = await tdb.sql`
      select metadata from upload_sessions where file_path = '/uploads/bare'`;
    expect(bare.metadata).toEqual({ title: 'bare' });
  });

  it('records the creator only of keys whose owner named an existing account', async () => {
    const keys = await tdb.sql<{ name: string; created_by: string | null }[]>`
      select name, created_by from api_keys order by name`;
    const byName = Object.fromEntries(keys.map((k) => [k.name, k.created_by]));
    expect(byName[`user-${alice}`]).toBe(alice);
    expect(byName[`user-${dev}`]).toBe(dev);
    expect(byName[`user-${gone}`]).toBeNull();
    expect(byName['github-octocat']).toBeNull();
    expect(byName.platform).toBeNull();
    expect(byName[ZERO]).toBeNull();
  });

  it('stops keys an ordinary person held that no account owns any more', async () => {
    const keys = await tdb.sql<{ name: string; is_active: boolean }[]>`
      select name, is_active from api_keys order by name`;
    const active = Object.fromEntries(keys.map((k) => [k.name, k.is_active]));
    expect(active[`user-${alice}`]).toBe(true);
    expect(active[`user-${dev}`]).toBe(true);
    expect(active[`user-${gone}`]).toBe(false);
    expect(active['github-octocat']).toBe(false);
    expect(active.platform).toBe(true);
    expect(active[ZERO]).toBe(true);
  });

  it('makes the local dev account an admin and everyone else a member', async () => {
    const users = await tdb.sql<{ id: string; role: string; disabled_at: Date | null }[]>`
      select id, role, disabled_at from users`;
    const roles = Object.fromEntries(users.map((u) => [u.id, u.role]));
    expect(roles).toEqual({ [alice]: 'member', [dev]: 'admin' });
    expect(users.every((u) => u.disabled_at === null)).toBe(true);
  });

  it('refuses a role other than admin or member', async () => {
    await expect(
      tdb.sql`insert into users (display_name, role) values ('x', 'operator')`,
    ).rejects.toThrow(/users_role_check/);
  });

  it('drops legacy owner claims and keeps the allowlist pins for adoption', async () => {
    const tables = await tdb.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`;
    const names = tables.map((t) => t.tablename);
    expect(names).not.toContain('legacy_owner_claims');
    expect(names).toEqual(
      expect.arrayContaining([
        'allowlist_pins',
        'password_credentials',
        'invites',
        'instance_meta',
      ]),
    );
    const pins = await tdb.sql`select entry, subject from allowlist_pins`;
    expect(pins).toEqual([{ entry: 'alice', subject: '1001' }]);
  });

  it('clears a key creator when the account is deleted', async () => {
    const [u] = await tdb.sql`insert into users (display_name) values ('temp') returning id`;
    const [k] = await tdb.sql`
      insert into api_keys (key_hash, name, creator_address, created_by)
      values ('hash-temp', 'temp', 'workspace', ${u.id}) returning id`;
    await tdb.sql`delete from users where id = ${u.id}`;
    const [after] = await tdb.sql`select created_by from api_keys where id = ${k.id}`;
    expect(after.created_by).toBeNull();
  });
});

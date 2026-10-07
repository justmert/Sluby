import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { hashApiKey } from '../api/auth/api-key.js';
import type * as Seeding from '../db/api-key-seeding.js';
import type * as Database from '../config/database.js';

// a database from before bootstrap_keys, holding a bootstrap key an older
// version seeded, then upgraded
describe.skipIf(!hasTestDatabase)('upgrade to bootstrap_keys (postgres)', () => {
  let tdb: TestDatabase;
  let seeding: typeof Seeding;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase({ through: '0014_signing_generation' });
    await tdb.sql`
      insert into api_keys (key_hash, name, scopes, creator_address)
      values (${hashApiKey('sluby_old_boot')}, 'bootstrap', ${['upload', 'read', 'manage']}, 'platform'),
             (${hashApiKey('sluby_tenant')}, 'bootstrap', ${['read']}, 'user:x')`;
    await tdb.migrateToLatest();
    database = await import('../config/database.js');
    seeding = await import('../db/api-key-seeding.js');
  });

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  it('records only the platform bootstrap key as seeded', async () => {
    const rows = await tdb.sql`select key_hash from bootstrap_keys`;
    expect(rows.map((r) => r.key_hash)).toEqual([hashApiKey('sluby_old_boot')]);
  });

  it('does not bring the old bootstrap key back once it is deleted', async () => {
    await tdb.sql`delete from api_keys where key_hash = ${hashApiKey('sluby_old_boot')}`;
    expect(await seeding.seedBootstrapApiKey(database.db, 'sluby_old_boot')).toBe('retired');
  });
});

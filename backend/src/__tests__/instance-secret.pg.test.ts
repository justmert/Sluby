import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as SecretQueries from '../db/queries/instance-secret.js';
import type * as Database from '../config/database.js';

describe.skipIf(!hasTestDatabase)('persisted session secret (postgres)', () => {
  let tdb: TestDatabase;
  let secrets: typeof SecretQueries;
  let database: typeof Database;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    secrets = await import('../db/queries/instance-secret.js');
    database = await import('../config/database.js');
  }, 60_000);

  afterAll(async () => {
    await database?.closeDatabase();
    await tdb?.drop();
  });

  it('stores the first secret and returns it on every later start', async () => {
    const first = 'a'.repeat(43);
    expect(await secrets.persistedSessionSecret(first)).toBe(first);
    expect(await secrets.persistedSessionSecret('b'.repeat(43))).toBe(first);
  });

  it('refuses a stored value too short to be a secret', async () => {
    await tdb.sql`update instance_meta set value = to_jsonb('short'::text) where key = 'session_secret'`;
    await expect(secrets.persistedSessionSecret('c'.repeat(43))).rejects.toThrow(
      'instance_meta holds no usable session secret',
    );
  });
});

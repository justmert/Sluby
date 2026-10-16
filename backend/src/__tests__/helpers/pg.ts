/**
 * Postgres-backed test support. Point SLUBY_TEST_DATABASE_URL at a server
 * (any database on it the role can CREATE DATABASE from, e.g.
 * postgres://postgres:pw@localhost:55432/postgres). Each test file gets its
 * own fresh database with the real drizzle migrations applied, so files can
 * run in parallel, and drops it afterwards.
 *
 * Without the variable the suites skip with a warning, so `npm test` works
 * on a machine with no Postgres. CI sets it, and under CI a missing value is
 * an error rather than a silent skip.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const TEST_DATABASE_URL = process.env.SLUBY_TEST_DATABASE_URL ?? '';
export const hasTestDatabase = TEST_DATABASE_URL !== '';

// the skip notice itself is printed once per run by global-setup.ts
if (!hasTestDatabase && process.env.CI) {
  throw new Error('SLUBY_TEST_DATABASE_URL is not set, but CI must run the postgres query tests');
}

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

export interface TestDatabase {
  url: string;
  /** A client on the test database for direct setup and assertions. */
  sql: postgres.Sql;
  /** Empty every application table between tests. */
  truncate: () => Promise<void>;
  drop: () => Promise<void>;
}

/**
 * Create and migrate a throwaway database, and point DATABASE_URL at it so
 * the app's config/database.js connects there once imported. Import the
 * query modules only after this resolves.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `sluby_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  const migrator = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(migrator), { migrationsFolder: MIGRATIONS });
  await migrator.end();

  process.env.DATABASE_URL = url.toString();
  const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });

  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');

  return {
    url: url.toString(),
    sql,
    truncate: async () => {
      await sql.unsafe(`truncate ${list} restart identity cascade`);
    },
    drop: async () => {
      await sql.end();
      const a = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

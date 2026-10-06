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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  /** Apply every migration not applied yet, as a deploy of a newer version does. */
  migrateToLatest: () => Promise<void>;
  drop: () => Promise<void>;
}

async function runMigrations(url: string, folder: string): Promise<void> {
  const migrator = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrator), { migrationsFolder: folder });
  } finally {
    await migrator.end();
  }
}

/** A copy of the migrations folder that stops after the migration tagged `tag`. */
function migrationsThrough(tag: string): string {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((e) => e.tag === tag);
  if (last === -1) throw new Error(`no migration tagged ${tag}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'sluby-migrations-'));
  mkdirSync(path.join(dir, 'meta'));
  const entries = journal.entries.slice(0, last + 1);
  for (const e of entries)
    copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

/**
 * Create and migrate a throwaway database, and point DATABASE_URL at it so
 * the app's config/database.js connects there once imported. Import the
 * query modules only after this resolves.
 *
 * `through` stops at an older migration, so a test can fill the schema of a
 * previous version and then run `migrateToLatest` over that data.
 */
export async function createTestDatabase(opts: { through?: string } = {}): Promise<TestDatabase> {
  const name = `sluby_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  if (opts.through) {
    const folder = migrationsThrough(opts.through);
    try {
      await runMigrations(url.toString(), folder);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  } else {
    await runMigrations(url.toString(), MIGRATIONS);
  }

  process.env.DATABASE_URL = url.toString();
  const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });

  return {
    url: url.toString(),
    sql,
    truncate: async () => {
      // listed each time, since migrateToLatest can add tables
      const tables = await sql<{ tablename: string }[]>`
        select tablename from pg_tables where schemaname = 'public'
      `;
      const list = tables.map((t) => `"${t.tablename}"`).join(', ');
      await sql.unsafe(`truncate ${list} restart identity cascade`);
    },
    migrateToLatest: () => runMigrations(url.toString(), MIGRATIONS),
    drop: async () => {
      await sql.end();
      const a = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

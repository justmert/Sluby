import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';

// backend/drizzle, from src/db when run with tsx and from dist/db when built,
// whatever the working directory
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Any fixed number; every sluby process migrating a database takes this one. */
const MIGRATION_LOCK_ID = 7_013_150_251;

async function runMigrations() {
  // one connection, so the session lock below and the migration share it
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // replicas starting together wait here in turn; the later ones then find
    // every migration applied and do nothing
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    console.log('Running migrations...');
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('Migrations complete.');
  } finally {
    await sql.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

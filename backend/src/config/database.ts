import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env.js';
import * as schema from '../db/schema.js';

/**
 * Raw postgres.js client.
 * Used by drizzle and available for raw queries or connection management.
 */
const client = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Drizzle ORM database instance with full schema awareness.
 * Supports relational queries via `db.query.<table>`.
 */
export const db = drizzle(client, { schema });

/**
 * Gracefully close the database connection pool.
 * Call during server shutdown.
 */
export async function closeDatabase(): Promise<void> {
  await client.end();
}

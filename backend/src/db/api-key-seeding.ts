import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { apiKeys } from './schema.js';
import { generateApiKey, hashApiKey } from '../api/auth/api-key.js';

// the two seeding paths run with different drizzle instances (the app's,
// with the relational schema, and the cli's bare one), so accept either
type Database = PostgresJsDatabase<Record<string, unknown>>;

/** Scopes of a seeded key: everything, so it can mint the account's other keys. */
export const ADMIN_SCOPES = ['upload', 'read', 'manage'];

/** Account the BOOTSTRAP_API_KEY belongs to. */
export const BOOTSTRAP_CREATOR_ADDRESS = 'platform';

/**
 * Make sure the operator-chosen BOOTSTRAP_API_KEY exists as a full-scope key
 * of the platform account. Idempotent across restarts: a row with the same
 * hash is left alone whatever its state (so a rotated, expired key stays
 * expired), while a deleted one is inserted again on the next start.
 */
export async function seedBootstrapApiKey(
  database: Database,
  rawKey: string,
): Promise<'created' | 'exists'> {
  const keyHash = hashApiKey(rawKey);

  const [existing] = await database
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  if (existing) return 'exists';

  await database.insert(apiKeys).values({
    keyHash,
    name: 'bootstrap',
    scopes: ADMIN_SCOPES,
    rateLimit: 1000,
    creatorAddress: BOOTSTRAP_CREATOR_ADDRESS,
    isActive: true,
  });
  return 'created';
}

/**
 * Mint a fresh full-scope key for `creatorAddress` (the `db:seed-key` cli).
 * Returns the raw key, which is not stored anywhere and must be shown once.
 */
export async function createAdminApiKey(
  database: Database,
  opts: { name: string; creatorAddress: string },
): Promise<{ id: string; rawKey: string }> {
  const { key, hash } = generateApiKey();
  const [row] = await database
    .insert(apiKeys)
    .values({
      keyHash: hash,
      name: opts.name,
      scopes: ADMIN_SCOPES,
      rateLimit: 1000,
      creatorAddress: opts.creatorAddress,
      isActive: true,
    })
    .returning({ id: apiKeys.id });
  return { id: row.id, rawKey: key };
}

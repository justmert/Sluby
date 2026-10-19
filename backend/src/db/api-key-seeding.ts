import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { apiKeys, bootstrapKeys } from './schema.js';
import { hashApiKey, keyPrefix } from '../api/auth/api-key.js';
import { createApiKey } from './queries/api-keys.js';
import { WORKSPACE_ADDRESS } from '../api/ownership.js';

type Database = PostgresJsDatabase<Record<string, unknown>>;

/** Scopes of a seeded key: everything, so it can mint the workspace's other keys. */
export const ADMIN_SCOPES = ['upload', 'read', 'manage'];

/**
 * Seed the BOOTSTRAP_API_KEY chosen by whoever runs the server as a
 * full-scope key of the workspace, once. It has no creator, so it acts as an
 * admin. The first start records its hash in
 * bootstrap_keys and inserts the key; later starts leave it alone, and once
 * it has been deleted or rotated away it is never inserted again
 * ('retired'), so revoking a leaked bootstrap key holds across restarts.
 * Both inserts skip on conflict, so replicas starting together cannot fail
 * on each other or seed it twice.
 */
export async function seedBootstrapApiKey(
  database: Database,
  rawKey: string,
): Promise<'created' | 'exists' | 'retired'> {
  const keyHash = hashApiKey(rawKey);

  return database.transaction(async (tx) => {
    const firstSeed = await tx
      .insert(bootstrapKeys)
      .values({ keyHash })
      .onConflictDoNothing()
      .returning({ keyHash: bootstrapKeys.keyHash });

    if (firstSeed.length > 0) {
      const inserted = await tx
        .insert(apiKeys)
        .values({
          keyHash,
          prefix: keyPrefix(rawKey),
          name: 'bootstrap',
          scopes: ADMIN_SCOPES,
          rateLimit: 1000,
          creatorAddress: WORKSPACE_ADDRESS,
          isActive: true,
        })
        .onConflictDoNothing({ target: apiKeys.keyHash })
        .returning({ id: apiKeys.id });
      // a key made before bootstrap_keys existed is already there
      return inserted.length > 0 ? 'created' : 'exists';
    }

    const [existing] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);
    return existing ? 'exists' : 'retired';
  });
}

/**
 * Mint a fresh full-scope key of the workspace with no creator, so it acts
 * as an admin (the `db:seed-key` cli). Returns the raw key, which is not
 * stored anywhere and must be shown once.
 */
export async function createAdminApiKey(opts: {
  name: string;
}): Promise<{ id: string; rawKey: string }> {
  const { apiKey, rawKey } = await createApiKey({
    name: opts.name,
    scopes: ADMIN_SCOPES,
    rateLimit: 1000,
    creatorAddress: WORKSPACE_ADDRESS,
  });
  return { id: apiKey.id, rawKey };
}

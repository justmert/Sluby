import { eq, and, desc, or, isNull, gt, count, sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { apiKeys, type ApiKey, type NewApiKey } from '../schema.js';
import { generateApiKey, hashApiKey, keyPrefix } from '../../api/auth/api-key.js';
import { KEY_USE_INTERVAL_MS } from '../../api/auth/key-usage.js';
import { paginateRows, type CursorKey, type Page } from '../../api/pagination.js';

/**
 * Create a new API key.
 * Returns both the database record and the raw key (shown once).
 */
export async function createApiKey(
  data: Omit<NewApiKey, 'keyHash'> & { rawKey?: string },
): Promise<{ apiKey: ApiKey; rawKey: string }> {
  const rawKey = data.rawKey ?? generateApiKey().key;
  const keyHash = hashApiKey(rawKey);

  const { rawKey: _rawKey, ...rest } = data;
  const [apiKey] = await db
    .insert(apiKeys)
    .values({ ...rest, keyHash, prefix: keyPrefix(rawKey) })
    .returning();

  return { apiKey, rawKey };
}

/**
 * Insert a key unless the account already holds `maxKeys` usable ones (active
 * and unexpired, rotation grace periods included). A per-account advisory
 * lock serialises concurrent creations, so parallel requests cannot all pass
 * the count and overshoot the cap. Null when the account is full.
 */
export async function createApiKeyWithinCap(
  values: Pick<
    NewApiKey,
    'keyHash' | 'prefix' | 'name' | 'scopes' | 'rateLimit' | 'creatorAddress'
  >,
  maxKeys: number,
): Promise<ApiKey | null> {
  return db.transaction(async (tx) => {
    const lockKey = `api-keys:${values.creatorAddress}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [{ usable }] = await tx
      .select({ usable: count() })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.creatorAddress, values.creatorAddress),
          eq(apiKeys.isActive, true),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
        ),
      );
    if (usable >= maxKeys) return null;
    const [apiKey] = await tx.insert(apiKeys).values(values).returning();
    return apiKey;
  });
}

/**
 * Look up an API key by its SHA-256 hash.
 * This is the primary lookup path for authentication middleware.
 */
export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
  return db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });
}

/**
 * One page of API keys, newest first. Only active, unexpired keys unless
 * `includeInactive`. `creatorAddress` undefined lists every account (the
 * platform identity). Keyset paging on (created_at, id), like the asset
 * listing, so keys created between pages are not skipped or repeated.
 */
export async function listApiKeys(opts: {
  creatorAddress?: string;
  includeInactive?: boolean;
  limit: number;
  cursor?: CursorKey;
}): Promise<Page<ApiKey>> {
  const { creatorAddress, includeInactive = false, limit, cursor } = opts;

  const conditions: SQL[] = [];
  if (creatorAddress !== undefined) {
    conditions.push(eq(apiKeys.creatorAddress, creatorAddress));
  }
  if (!includeInactive) {
    conditions.push(eq(apiKeys.isActive, true));
    // Not expired or no expiration set
    conditions.push(or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))!);
  }
  // timestamps compare at millisecond precision, the precision of the cursor
  const createdMs = sql`date_trunc('milliseconds', ${apiKeys.createdAt})`;
  if (cursor) {
    conditions.push(
      sql`(${createdMs}, ${apiKeys.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db.query.apiKeys.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    limit: limit + 1,
    orderBy: [desc(createdMs), desc(apiKeys.id)],
  });
  return paginateRows(rows, limit);
}

/**
 * Permanently delete an API key.
 *
 * `owner` constrains the delete to the caller's `creatorAddress` so one
 * tenant cannot revoke another tenant's key by guessing its UUID. Omit it
 * only for platform/internal callers.
 */
export async function deleteApiKey(id: string, owner?: string): Promise<ApiKey | undefined> {
  const [deleted] = await db
    .delete(apiKeys)
    .where(
      owner !== undefined
        ? and(eq(apiKeys.id, id), eq(apiKeys.creatorAddress, owner))
        : eq(apiKeys.id, id),
    )
    .returning();
  return deleted;
}

export type RotateResult =
  | { status: 'rotated'; replacement: ApiKey; retiredAt: Date }
  | { status: 'not_found' }
  | { status: 'already_rotated'; replacedById: string | null };

/**
 * Replace key `id` with a new secret carrying the same name, scopes and rate
 * limit, and retire the old one at `retireAt`. Runs in a transaction with the
 * old row locked, and a key that already has a replacement is refused, so
 * concurrent or repeated rotations of one key mint exactly one replacement,
 * grace period or not. An existing, earlier expiry is never pushed out.
 */
export async function rotateApiKey(
  id: string,
  owner: string | undefined,
  replacement: { keyHash: string; prefix: string },
  retireAt: Date,
): Promise<RotateResult> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const conditions = [
      eq(apiKeys.id, id),
      eq(apiKeys.isActive, true),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
    ];
    if (owner !== undefined) conditions.push(eq(apiKeys.creatorAddress, owner));

    const [old] = await tx
      .select()
      .from(apiKeys)
      .where(and(...conditions))
      .for('update');
    if (!old) return { status: 'not_found' };
    // a rotated key in its grace period is still valid, but it already has a
    // successor; a second replacement would leave two live keys behind
    if (old.replacedById) return { status: 'already_rotated', replacedById: old.replacedById };

    const [created] = await tx
      .insert(apiKeys)
      .values({
        keyHash: replacement.keyHash,
        prefix: replacement.prefix,
        name: old.name,
        scopes: old.scopes,
        rateLimit: old.rateLimit,
        creatorAddress: old.creatorAddress,
      })
      .returning();

    const retiredAt = old.expiresAt && old.expiresAt < retireAt ? old.expiresAt : retireAt;
    await tx
      .update(apiKeys)
      .set({ expiresAt: retiredAt, replacedById: created.id })
      .where(eq(apiKeys.id, old.id));
    return { status: 'rotated', replacement: created, retiredAt };
  });
}

/**
 * Mark key `id` as used now, unless the stored use is under a minute old.
 * The condition makes replicas that each throttle on their own write at most
 * about once a minute between them.
 */
export async function touchApiKeyLastUsed(id: string): Promise<void> {
  const interval = `${KEY_USE_INTERVAL_MS} milliseconds`;
  await db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, id),
        or(isNull(apiKeys.lastUsedAt), sql`${apiKeys.lastUsedAt} < now() - ${interval}::interval`),
      ),
    );
}

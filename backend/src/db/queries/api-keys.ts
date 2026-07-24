import { eq, and, desc, or, isNull, gt } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { apiKeys, type ApiKey, type NewApiKey } from '../schema.js';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a new raw API key string with a "sluby_" prefix.
 * The raw key is returned only once at creation time.
 */
export function generateRawApiKey(): string {
  const bytes = randomBytes(32);
  return `sluby_${bytes.toString('base64url')}`;
}

/**
 * Hash a raw API key with SHA-256 for storage and lookup.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Create a new API key.
 * Returns both the database record and the raw key (shown once).
 */
export async function createApiKey(
  data: Omit<NewApiKey, 'keyHash'> & { rawKey?: string },
): Promise<{ apiKey: ApiKey; rawKey: string }> {
  const rawKey = data.rawKey ?? generateRawApiKey();
  const keyHash = hashApiKey(rawKey);

  const { rawKey: _rawKey, ...rest } = data;
  const [apiKey] = await db
    .insert(apiKeys)
    .values({ ...rest, keyHash })
    .returning();

  return { apiKey, rawKey };
}

/**
 * Look up an API key by its SHA-256 hash.
 * This is the primary lookup path for authentication middleware.
 */
export async function getApiKeyByHash(
  keyHash: string,
): Promise<ApiKey | undefined> {
  return db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });
}

/**
 * Validate a raw API key.
 * Hashes the key, looks it up, and checks it is active and not expired.
 * Returns the API key record if valid, undefined otherwise.
 */
export async function validateApiKey(
  rawKey: string,
): Promise<ApiKey | undefined> {
  const keyHash = hashApiKey(rawKey);
  const key = await getApiKeyByHash(keyHash);

  if (!key) return undefined;
  if (!key.isActive) return undefined;

  // Check expiration
  if (key.expiresAt && key.expiresAt < new Date()) {
    return undefined;
  }

  return key;
}

/**
 * List API keys for a given creator address.
 * Only returns active, non-expired keys by default.
 */
export async function listApiKeys(opts?: {
  creatorAddress?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ApiKey[]> {
  const {
    creatorAddress,
    includeInactive = false,
    limit = 50,
    offset = 0,
  } = opts ?? {};

  const conditions = [];
  if (creatorAddress) {
    conditions.push(eq(apiKeys.creatorAddress, creatorAddress));
  }
  if (!includeInactive) {
    conditions.push(eq(apiKeys.isActive, true));
    // Not expired or no expiration set
    conditions.push(
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db.query.apiKeys.findMany({
    where,
    limit,
    offset,
    orderBy: [desc(apiKeys.createdAt)],
  });
}

/**
 * Permanently delete an API key.
 *
 * `owner` constrains the delete to the caller's `creatorAddress` so one
 * tenant cannot revoke another tenant's key by guessing its UUID. Omit it
 * only for platform/internal callers.
 */
export async function deleteApiKey(
  id: string,
  owner?: string,
): Promise<ApiKey | undefined> {
  const [deleted] = await db
    .delete(apiKeys)
    .where(
      owner
        ? and(eq(apiKeys.id, id), eq(apiKeys.creatorAddress, owner))
        : eq(apiKeys.id, id),
    )
    .returning();
  return deleted;
}

import { createHash, randomBytes } from 'node:crypto';

/**
 * The one place API keys are minted and hashed. The raw key is shown to the
 * caller once; only its SHA-256 hex digest is stored, and every lookup
 * (bearer middleware, tus, the bootstrap and CLI seeders) hashes the
 * presented key the same way and matches the digest in the database.
 */

export const API_KEY_PREFIX = 'sluby_';

/** Random bytes behind each key; 32 bytes is 43 base64url characters. */
const API_KEY_BYTES = 32;

/** SHA-256 hex digest of a raw key, as stored in `api_keys.key_hash`. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A new random key with the "sluby_" prefix, plus the hash to store. */
export function generateApiKey(): { key: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
  return { key, hash: hashApiKey(key) };
}

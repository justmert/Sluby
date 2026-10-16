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

/** Characters of a key kept in the clear: "sluby_" and the first 6 random ones. */
export const KEY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;

/**
 * The start of a raw key, stored and listed so people can tell which key a
 * server holds. 6 of 43 random characters leave far too few bits to matter.
 */
export function keyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

/** A new random key with the "sluby_" prefix, plus the hash and prefix to store. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
  return { key, hash: hashApiKey(key), prefix: keyPrefix(key) };
}

import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a new API key with the "wss_" prefix.
 * Returns both the plain key (shown once) and its hash (stored in DB).
 */
export function generateApiKey(): { key: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const key = `wss_${raw}`;
  const hash = hashApiKey(key);
  return { key, hash };
}

/**
 * Hash an API key with SHA-256 for secure storage.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

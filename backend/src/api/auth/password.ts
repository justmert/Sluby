import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing for password sign-in. Hashes are stored as
 * `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>` so verification reads the
 * parameters back and they can be raised later without breaking old hashes.
 */

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// N=32768, r=8 needs 128 * N * r = 32 MiB, which node's 32 MiB default refuses
const MAX_MEM = 64 * 1024 * 1024;

const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 32;

const MIN_LENGTH = 10;
const MAX_LENGTH = 256;

interface Params {
  N: number;
  r: number;
  p: number;
}

function scryptAsync(pw: string, salt: Buffer, keylen: number, params: Params): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: MAX_MEM };
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(pw, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

interface Parsed extends Params {
  salt: Buffer;
  hash: Buffer;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INT = /^[1-9][0-9]*$/;

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts;
  if (![n, r, p].every((v) => POSITIVE_INT.test(v))) return null;
  if (!B64URL.test(salt) || !B64URL.test(hash)) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  // scrypt wants N to be a power of two above 1
  if (params.N < 2 || (params.N & (params.N - 1)) !== 0) return null;
  const parsed = {
    ...params,
    salt: Buffer.from(salt, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  };
  // a truncated hash would compare equal to a truncated key of any password
  if (parsed.salt.length < MIN_SALT_BYTES || parsed.hash.length < MIN_HASH_BYTES) return null;
  return parsed;
}

// stands in for a missing or unreadable hash, so an unknown email costs the
// same scrypt run as a known one and timing does not tell them apart
const DUMMY_SALT = Buffer.alloc(SALT_BYTES);
const DUMMY_HASH = Buffer.alloc(KEY_LENGTH);

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const parsed = stored === null ? null : parse(stored);
  if (!parsed) {
    const key = await scryptAsync(pw, DUMMY_SALT, KEY_LENGTH, { N, r: R, p: P });
    timingSafeEqual(key, DUMMY_HASH);
    return false;
  }
  const key = await scryptAsync(pw, parsed.salt, parsed.hash.length, parsed);
  return timingSafeEqual(key, parsed.hash);
}

/** The reason a new password is refused, or null when it is fine. */
export function passwordProblem(pw: string): string | null {
  // count code points so an emoji is one character, not two
  const length = [...pw].length;
  if (length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`;
  return null;
}

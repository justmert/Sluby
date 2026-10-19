import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The one-time code that lets the first admin set up a fresh install. It is
 * derived from SESSION_SECRET, so whoever can read the server's logs or
 * environment can claim the install and nobody else can.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;

function rawCode(secret: string): string {
  const digest = createHmac('sha256', secret).update('sluby setup code v1').digest();
  // the first 8 bytes hold 64 bits; drop the low 14 to keep the first 50
  const bits = digest.readBigUInt64BE(0) >> 14n;
  let code = '';
  for (let i = LENGTH - 1; i >= 0; i--) {
    code += ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  }
  return code;
}

/** The code as shown to people, "XXXXX-XXXXX". */
export function setupCode(secret: string): string {
  const code = rawCode(secret);
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function sameSetupCode(given: string, secret: string): boolean {
  // people retype the code, so forgive case, spacing, dashes and the letters
  // crockford base32 reads as digits
  const normalised = given
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  const a = Buffer.from(normalised);
  const b = Buffer.from(rawCode(secret));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

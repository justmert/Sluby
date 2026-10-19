import { describe, it, expect, vi } from 'vitest';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, passwordProblem, verifyPassword } from '../api/auth/password.js';

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// every case runs real scrypt (32 MiB, about 100 ms a hash); a busy runner
// stretches a case with several of them past the 5 s default
vi.setConfig({ testTimeout: 20_000 });

describe('hashPassword', () => {
  it('stores scrypt parameters, a 16-byte salt and a 64-byte key', async () => {
    const stored = await hashPassword('correct horse battery');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(parts[4]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[5]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(64);
  });

  it('is the scrypt of the password under the stored salt', async () => {
    const stored = await hashPassword('correct horse battery');
    const [, , , , salt, hash] = stored.split('$');
    const expected = await scryptAsync(
      'correct horse battery',
      Buffer.from(salt, 'base64url'),
      64,
      {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      },
    );
    expect(Buffer.from(hash, 'base64url').equals(expected)).toBe(true);
  });

  it('salts every hash differently', async () => {
    const a = await hashPassword('same password here');
    const b = await hashPassword('same password here');
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterY', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('reads the parameters from the stored hash', async () => {
    // a hash made with other parameters still verifies, so they can be raised later
    const salt = Buffer.alloc(16, 7);
    const key = await scryptAsync('older password', salt, 64, {
      N: 1024,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const stored = `scrypt$1024$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
    expect(await verifyPassword('older password', stored)).toBe(true);
    expect(await verifyPassword('other password', stored)).toBe(false);
  });

  it('returns false with no stored hash', async () => {
    expect(await verifyPassword('anything at all', null)).toBe(false);
  });

  it('returns false for malformed stored hashes', async () => {
    const good = await hashPassword('correct horse battery');
    const [, n, r, p, salt, hash] = good.split('$');
    const bad = [
      '',
      'garbage',
      `bcrypt$${n}$${r}$${p}$${salt}$${hash}`,
      `scrypt$${n}$${r}$${p}$${salt}`,
      `scrypt$abc$${r}$${p}$${salt}$${hash}`,
      `scrypt$1000$${r}$${p}$${salt}$${hash}`,
      `scrypt$${n}$0$${p}$${salt}$${hash}`,
      `scrypt$${n}$${r}$-1$${salt}$${hash}`,
      `scrypt$${n}$${r}$${p}$$${hash}`,
      `scrypt$${n}$${r}$${p}$${salt}$`,
      `scrypt$${n}$${r}$${p}$${salt}$${hash}$extra`,
      // too short to mean anything: an empty key would match every password
      `scrypt$${n}$${r}$${p}$${salt}$A`,
      `scrypt$${n}$${r}$${p}$${salt}$${hash.slice(0, 20)}`,
      `scrypt$${n}$${r}$${p}$AAAA$${hash}`,
    ];
    for (const stored of bad) {
      expect(await verifyPassword('correct horse battery', stored)).toBe(false);
    }
  });
});

describe('passwordProblem', () => {
  it('wants 10 to 256 characters', () => {
    expect(passwordProblem('')).toBe('Use at least 10 characters.');
    expect(passwordProblem('a'.repeat(9))).toBe('Use at least 10 characters.');
    expect(passwordProblem('a'.repeat(10))).toBeNull();
    expect(passwordProblem('a'.repeat(256))).toBeNull();
    expect(passwordProblem('a'.repeat(257))).toBe('Use at most 256 characters.');
  });

  it('counts code points, not utf-16 units', () => {
    // each emoji is two utf-16 units but one character
    expect(passwordProblem('\u{1F600}'.repeat(9))).toBe('Use at least 10 characters.');
    expect(passwordProblem('\u{1F600}'.repeat(10))).toBeNull();
    expect(passwordProblem('\u{1F600}'.repeat(256))).toBeNull();
    expect(passwordProblem('\u{1F600}'.repeat(257))).toBe('Use at most 256 characters.');
  });

  it('has no other rules', () => {
    expect(passwordProblem('          ')).toBeNull();
    expect(passwordProblem('aaaaaaaaaa')).toBeNull();
  });
});

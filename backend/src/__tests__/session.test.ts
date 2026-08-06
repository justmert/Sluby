import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  signSession,
  verifySession,
  parseCookieHeader,
  buildSessionCookie,
  buildClearCookie,
  SESSION_COOKIE_NAME,
} from '../api/auth/session.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const SECRET = 'test-session-secret-at-least-32-chars-long';
const OTHER_SECRET = 'a-completely-different-secret-value-here!!';
const LOGIN = 'octocat';

afterEach(() => {
  vi.useRealTimers();
});

describe('SESSION_COOKIE_NAME', () => {
  it('is the stable cookie name the rest of the app keys off', () => {
    expect(SESSION_COOKIE_NAME).toBe('sluby_session');
  });
});

describe('signSession', () => {
  it('produces a two-part <payload>.<signature> token', () => {
    const token = signSession(LOGIN, SECRET);
    const parts = token.split('.');

    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('base64url-encodes a payload carrying the login and an expiry', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signSession(LOGIN, SECRET, 3600);
    const [encoded] = token.split('.');

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      login: string;
      exp: number;
    };

    expect(payload.login).toBe(LOGIN);
    expect(payload.exp).toBeGreaterThanOrEqual(before + 3600);
    expect(payload.exp).toBeLessThanOrEqual(before + 3600 + 5);
  });

  it('uses base64url alphabet only (safe to put in a cookie unescaped)', () => {
    const token = signSession(LOGIN, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('defaults to a seven-day TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const [encoded] = signSession(LOGIN, SECRET).split('.');
    const { exp } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      exp: number;
    };

    expect(exp - before).toBeGreaterThanOrEqual(7 * 24 * 3600 - 2);
    expect(exp - before).toBeLessThanOrEqual(7 * 24 * 3600 + 2);
  });

  it('binds the signature to the secret', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const a = signSession(LOGIN, SECRET, 3600);
    const b = signSession(LOGIN, OTHER_SECRET, 3600);

    // Same payload (clock frozen), different HMAC.
    expect(a.split('.')[0]).toBe(b.split('.')[0]);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });
});

describe('verifySession', () => {
  it('round-trips a signed session back to its payload', () => {
    const token = signSession(LOGIN, SECRET, 3600);

    const payload = verifySession(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.login).toBe(LOGIN);
    expect(typeof payload?.exp).toBe('number');
  });

  it('preserves a login with unusual characters', () => {
    const weird = 'user-name_123.ünïcøde';
    const payload = verifySession(signSession(weird, SECRET, 3600), SECRET);

    expect(payload?.login).toBe(weird);
  });

  it('returns null for an undefined or empty token', () => {
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession('', SECRET)).toBeNull();
  });

  it('returns null for a malformed token with no separator', () => {
    expect(verifySession('nodotinhere', SECRET)).toBeNull();
    expect(verifySession(signSession(LOGIN, SECRET).replace('.', ''), SECRET)).toBeNull();
  });

  it('returns null when the payload half is empty', () => {
    const token = signSession(LOGIN, SECRET, 3600);
    expect(verifySession(`.${token.split('.')[1]}`, SECRET)).toBeNull();
  });

  it('returns null when the signature half is empty', () => {
    const token = signSession(LOGIN, SECRET, 3600);
    expect(verifySession(`${token.split('.')[0]}.`, SECRET)).toBeNull();
  });

  it('returns null for a tampered signature of the correct length', () => {
    const token = signSession(LOGIN, SECRET, 3600);
    const [encoded, sig] = token.split('.');
    // Flip the final character, keeping the length identical so the compare
    // reaches timingSafeEqual rather than being short-circuited by the guard.
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(flipped).toHaveLength(sig.length);
    expect(flipped).not.toBe(sig);

    expect(verifySession(`${encoded}.${flipped}`, SECRET)).toBeNull();
  });

  it('returns null for a tampered payload with the original signature', () => {
    const token = signSession(LOGIN, SECRET, 3600);
    const [, sig] = token.split('.');

    // Attacker rewrites the identity to a different user and reuses the HMAC.
    const forged = Buffer.from(
      JSON.stringify({ login: 'attacker', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');

    expect(verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('returns null (and does NOT throw) for a wrong-length signature', () => {
    // node's crypto.timingSafeEqual throws a RangeError when the two buffers
    // differ in length, so verifySession must length-guard before comparing.
    // Any throw here would surface as a 500 on the auth path.
    const [encoded] = signSession(LOGIN, SECRET, 3600).split('.');

    // A base64url SHA-256 digest is 43 chars; every entry below differs.
    for (const badSig of ['a', 'ab', 'short', 'x'.repeat(42), 'x'.repeat(44), 'x'.repeat(200)]) {
      expect(() => verifySession(`${encoded}.${badSig}`, SECRET)).not.toThrow();
      expect(verifySession(`${encoded}.${badSig}`, SECRET)).toBeNull();
    }
  });

  it('proves timingSafeEqual really would throw on that input', () => {
    // Guards against the length check being deleted as "redundant".
    expect(() => crypto.timingSafeEqual(Buffer.from('a'), Buffer.from('abcdef'))).toThrow();
  });

  it('returns null when verified with a different secret', () => {
    const token = signSession(LOGIN, SECRET, 3600);

    expect(verifySession(token, OTHER_SECRET)).toBeNull();
    // ...and still valid under the right one, so the token itself is fine.
    expect(verifySession(token, SECRET)?.login).toBe(LOGIN);
  });

  it('returns null for an expired session', () => {
    const expired = signSession(LOGIN, SECRET, -10);

    expect(verifySession(expired, SECRET)).toBeNull();
  });

  it('returns null once a valid session ages past its expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const token = signSession(LOGIN, SECRET, 60);
    expect(verifySession(token, SECRET)?.login).toBe(LOGIN);

    vi.setSystemTime(new Date('2026-01-01T00:02:00Z')); // +120s
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it('returns null for a correctly signed token whose payload is not JSON', () => {
    const encoded = Buffer.from('this is not json').toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');

    expect(verifySession(`${encoded}.${sig}`, SECRET)).toBeNull();
  });

  it('returns null for a correctly signed payload missing login or exp', () => {
    const sign = (obj: unknown) => {
      const encoded = Buffer.from(JSON.stringify(obj)).toString('base64url');
      const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
      return `${encoded}.${sig}`;
    };
    const future = Math.floor(Date.now() / 1000) + 3600;

    expect(verifySession(sign({ exp: future }), SECRET)).toBeNull();
    expect(verifySession(sign({ login: LOGIN }), SECRET)).toBeNull();
    expect(verifySession(sign({ login: 42, exp: future }), SECRET)).toBeNull();
    expect(verifySession(sign({ login: LOGIN, exp: String(future) }), SECRET)).toBeNull();
  });
});

describe('parseCookieHeader', () => {
  it('returns an empty object for an undefined header', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it('returns an empty object for an empty header', () => {
    expect(parseCookieHeader('')).toEqual({});
  });

  it('parses a single cookie', () => {
    expect(parseCookieHeader('sluby_session=abc123')).toEqual({
      sluby_session: 'abc123',
    });
  });

  it('parses multiple cookies separated by "; "', () => {
    expect(parseCookieHeader('a=1; b=2; sluby_session=tok')).toEqual({
      a: '1',
      b: '2',
      sluby_session: 'tok',
    });
  });

  it('tolerates missing whitespace around the separators', () => {
    expect(parseCookieHeader('a=1;b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('url-decodes values', () => {
    expect(parseCookieHeader('redirect=%2Fdashboard%3Ftab%3Dassets')).toEqual({
      redirect: '/dashboard?tab=assets',
    });
    expect(parseCookieHeader('name=John%20Doe')).toEqual({ name: 'John Doe' });
  });

  it('skips a malformed segment with no "="', () => {
    expect(parseCookieHeader('justaflag; a=1')).toEqual({ a: '1' });
    expect(parseCookieHeader('justaflag')).toEqual({});
  });

  it('skips empty segments produced by stray semicolons', () => {
    expect(parseCookieHeader('; a=1;; b=2;')).toEqual({ a: '1', b: '2' });
  });

  it('keeps an empty value for a cookie set to nothing', () => {
    expect(parseCookieHeader('sluby_session=')).toEqual({ sluby_session: '' });
  });

  it('keeps "=" characters inside the value (splits on the first one only)', () => {
    expect(parseCookieHeader('token=a=b=c')).toEqual({ token: 'a=b=c' });
  });

  it('falls back to the raw value when percent-decoding fails', () => {
    // A lone '%' is not a valid escape; decodeURIComponent throws on it.
    expect(() => parseCookieHeader('a=100%')).not.toThrow();
    expect(parseCookieHeader('a=100%')).toEqual({ a: '100%' });
  });

  it('lets a later duplicate cookie win', () => {
    expect(parseCookieHeader('a=1; a=2')).toEqual({ a: '2' });
  });
});

describe('cookie round trip', () => {
  it('survives buildSessionCookie -> Cookie header -> parse -> verify', () => {
    const token = signSession(LOGIN, SECRET, 3600);
    const setCookie = buildSessionCookie(token, { maxAgeSec: 3600, secure: true });

    // A browser echoes back only the `name=value` pair, not the attributes.
    const namePair = setCookie.split(';')[0];
    const jar = parseCookieHeader(namePair);

    expect(verifySession(jar[SESSION_COOKIE_NAME], SECRET)?.login).toBe(LOGIN);
  });

  it('buildSessionCookie sets the hardening attributes', () => {
    const cookie = buildSessionCookie('tok', { maxAgeSec: 604800, secure: true });

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).toContain('Secure');
  });

  it('buildSessionCookie omits Secure over plain http', () => {
    const cookie = buildSessionCookie('tok', { maxAgeSec: 60, secure: false });

    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('buildClearCookie expires the cookie immediately', () => {
    const cookie = buildClearCookie(true);

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(buildClearCookie(false)).not.toContain('Secure');
  });
});

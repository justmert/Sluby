import crypto from 'node:crypto';

/**
 * Signed session cookie utilities.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`
 *
 * The payload is a JSON object `{ login, exp }` where `exp` is a Unix
 * timestamp in seconds. Verification checks the HMAC and the expiry in
 * constant time — no external JWT library needed for this narrow use
 * case.
 */

export interface SessionPayload {
  /** GitHub login of the authenticated user. */
  login: string;
  /** Unix expiry timestamp (seconds). */
  exp: number;
}

const SEVEN_DAYS_SEC = 7 * 24 * 3600;

export const SESSION_COOKIE_NAME = 'sluby_session';

export function signSession(
  login: string,
  secret: string,
  ttlSec: number = SEVEN_DAYS_SEC,
): string {
  const payload: SessionPayload = {
    login,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (
      typeof payload.login !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Parse the `Cookie` request header into a plain object. Handles the
 * subset we need — no quoted values, no cookie attributes (those are
 * response-only).
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Build a `Set-Cookie` header value with sane defaults: HttpOnly,
 * SameSite=Lax (so the OAuth redirect from github.com carries it),
 * Secure when the public URL is https, and Path=/.
 */
export function buildSessionCookie(
  value: string,
  options: {
    maxAgeSec: number;
    secure: boolean;
  },
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSec}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

import crypto from 'node:crypto';
import { isAccountAllowed, type Account } from './access.js';

/**
 * Signed session cookie utilities.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`
 *
 * The payload is a JSON object `{ sid, uid, exp }`: `sid` is the
 * studio_sessions row the cookie stands for, `uid` the account it belongs to,
 * `exp` a Unix timestamp in seconds. Verifying the HMAC and expiry here only proves the cookie was
 * issued by this server; resolveSession() also checks the row is still live,
 * which is what makes a session revocable.
 */

export interface SessionPayload {
  /** studio_sessions row id. */
  sid: string;
  /** The account (users row) the session belongs to. */
  uid: string;
  /** Unix expiry timestamp (seconds). */
  exp: number;
}

export const SESSION_TTL_SEC = 7 * 24 * 3600;

export const SESSION_COOKIE_NAME = 'sluby_session';

export function signSession(
  sid: string,
  uid: string,
  secret: string,
  ttlSec: number = SESSION_TTL_SEC,
): string {
  const payload: SessionPayload = {
    sid,
    uid,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * The payload of a cookie this server signed, whether or not it has expired;
 * null when the signature or the shape is wrong.
 */
function readSessionCookie(token: string | undefined, secret: string): SessionPayload | null {
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
      typeof payload.sid !== 'string' ||
      typeof payload.uid !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

const cookieExpired = (payload: SessionPayload) => payload.exp < Math.floor(Date.now() / 1000);

export function verifySession(token: string | undefined, secret: string): SessionPayload | null {
  const payload = readSessionCookie(token, secret);
  return payload && !cookieExpired(payload) ? payload : null;
}

/**
 * Parse the `Cookie` request header into a plain object. Handles the
 * subset we need: no quoted values, no cookie attributes (those are
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

/** A live Studio session, as stored server-side. */
export interface ActiveSession {
  id: string;
  userId: string;
  /** The identity the browser signed in with. */
  identityId: string;
  expiresAt: Date;
  /** The last request made with it, to within SESSION_SEEN_INTERVAL_MS. */
  lastSeenAt: Date | null;
}

/** How stale last_seen_at may get before a request writes it again. */
export const SESSION_SEEN_INTERVAL_MS = 5 * 60 * 1000;

/** Looks up a session row that is neither revoked nor expired. */
export type FindActiveSession = (sid: string) => Promise<ActiveSession | undefined>;

/**
 * The live session behind a request's cookie header, with its account, or
 * null: the cookie must verify, its row must still be live, and the account
 * must not be removed. Checked on every request, not only at sign-in, so
 * removing a member ends their sessions too.
 */
export async function resolveSession(
  cookieHeader: string | undefined,
  opts: {
    secret: string;
    findActiveSession: FindActiveSession;
    getAccount: (userId: string) => Promise<Account | null>;
    /** Note the session was used now; must not throw or wait. */
    markSeen: (sid: string) => void;
  },
): Promise<{ session: ActiveSession; account: Account } | null> {
  const payload = verifySession(parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME], opts.secret);
  if (!payload) return null;
  const session = await opts.findActiveSession(payload.sid);
  if (!session || session.userId !== payload.uid) return null;
  const account = await opts.getAccount(session.userId);
  if (!account || !isAccountAllowed(account)) return null;
  if (
    !session.lastSeenAt ||
    Date.now() - session.lastSeenAt.getTime() >= SESSION_SEEN_INTERVAL_MS
  ) {
    opts.markSeen(session.id);
  }
  return { session, account };
}

/**
 * Why a request has no live session, for the 401 a browser gets: `missing`
 * (no cookie, or one this server did not sign), `expired`, `revoked` (signed
 * out here or from another browser, or the row is gone) or `not_allowed` (the
 * account was removed from the workspace).
 */
export type SessionEndReason = 'missing' | 'expired' | 'revoked' | 'not_allowed';

/** A session row in any state. */
export interface SessionState {
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type FindSession = (sid: string) => Promise<SessionState | undefined>;

/**
 * The reason behind a cookie header resolveSession turned down. Only called
 * on that path, so a signed-in request never pays for the extra lookup.
 */
export async function whySessionEnded(
  cookieHeader: string | undefined,
  opts: {
    secret: string;
    findSession: FindSession;
    getAccount: (userId: string) => Promise<Account | null>;
  },
): Promise<SessionEndReason> {
  const payload = readSessionCookie(
    parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME],
    opts.secret,
  );
  if (!payload) return 'missing';
  if (cookieExpired(payload)) return 'expired';
  const row = await opts.findSession(payload.sid);
  if (!row || row.userId !== payload.uid) return 'revoked';
  const account = await opts.getAccount(row.userId);
  // removing a member also ends their sessions, so the account is checked
  // before the revocation: they are told they were removed, not signed out
  if (account && !isAccountAllowed(account)) return 'not_allowed';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt <= new Date()) return 'expired';
  if (!account) return 'revoked';
  // live by now: it ended and came back between the two reads, which only a
  // race allows; the browser should simply try again
  return 'missing';
}

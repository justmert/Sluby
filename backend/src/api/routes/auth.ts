import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../middleware/error-handler.js';
import {
  SESSION_TTL_SEC,
  buildClearCookie,
  buildSessionCookie,
  parseCookieHeader,
  resolveSession,
  signSession,
  whySessionEnded,
  type ActiveSession,
  type FindActiveSession,
  type FindSession,
} from '../auth/session.js';
import type { Account } from '../auth/access.js';
import { isOperatorAccount, operatorAllowlist } from '../auth/operators.js';
import { getProvider, SignInError, type SignInProvider } from '../auth/providers/index.js';
import type { SignInInput, SignInResult } from '../../db/queries/accounts.js';

function isSecure(): boolean {
  return env.PUBLIC_URL.startsWith('https://');
}

function callbackUrl(provider: SignInProvider): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/api/v1/auth/${provider.id}/callback`;
}

const DEFAULT_LANDING = '/studio';

/**
 * Why a sign-in did not finish, as the Studio reads it from `signin_error`:
 * the handshake expired or came from another browser, the account is not on
 * the allowlist, the person cancelled at the provider, the provider failed,
 * or the provider is not configured on this server.
 */
export type SignInFailure =
  'expired_handshake' | 'not_allowed' | 'cancelled' | 'provider_failed' | 'not_configured';

/**
 * Send the browser back to the Studio with the failure in the query, so it
 * can explain it on its own sign-in screen. `handle` is the provider login
 * that was refused; the Studio must show it as text, never as markup.
 */
function signInFailed(res: Response, code: SignInFailure, handle?: string): void {
  const query = new URLSearchParams({ signin_error: code });
  if (handle !== undefined) query.set('handle', handle);
  res.set('Cache-Control', 'no-store').redirect(`${DEFAULT_LANDING}?${query.toString()}`);
}

/**
 * Where to send the browser after sign-in: a path on this server, or /studio.
 * The value is resolved against PUBLIC_URL the way a browser would, so
 * `/\evil.example` (a backslash is a slash to browsers), `/\t/evil.example`
 * (tabs are dropped) and `//evil.example` all land on another origin and are
 * refused.
 */
export function safeRedirectPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return DEFAULT_LANDING;
  const base = new URL(env.PUBLIC_URL);
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return DEFAULT_LANDING;
  }
  if (url.origin !== base.origin) return DEFAULT_LANDING;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // dot segments can still normalise into a leading //, which a browser
  // reads as a host
  if (!path.startsWith('/') || path.startsWith('//')) return DEFAULT_LANDING;
  return path;
}

/**
 * The state of a sign-in in progress lives in a cookie of the browser that
 * started it, not on the server: the callback only accepts the state that
 * this browser's cookie holds, so a callback URL made in someone else's
 * browser (login CSRF) is refused, and any backend replica can finish it.
 */
const HANDSHAKE_COOKIE = 'sluby_signin';
const HANDSHAKE_PATH = '/api/v1/auth';
const HANDSHAKE_TTL_SEC = 10 * 60;

interface Handshake {
  provider: string;
  issuedAt: number;
  state: string;
  next: string;
}

function handshakeCookie(value: string, maxAgeSec: number): string {
  const parts = [
    `${HANDSHAKE_COOKIE}=${value}`,
    `Path=${HANDSHAKE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecure()) parts.push('Secure');
  return parts.join('; ');
}

function encodeHandshake(h: Handshake): string {
  const next = Buffer.from(h.next, 'utf8').toString('base64url');
  return `${h.provider}.${h.issuedAt}.${h.state}.${next}`;
}

function decodeHandshake(value: string | undefined): Handshake | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [provider, issuedAt, state, next] = parts;
  const issued = Number(issuedAt);
  if (!provider || !state || !Number.isSafeInteger(issued)) return null;
  return {
    provider,
    issuedAt: issued,
    state,
    next: Buffer.from(next, 'base64url').toString('utf8'),
  };
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export interface StudioSessionRecord {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
}

export interface AuthRouteDeps {
  /** Apply the allowlist, find or create the account and claim legacy data, see signInIdentity. */
  signIn: (input: SignInInput) => Promise<SignInResult>;
  getAccount: (userId: string) => Promise<Account | null>;
  /** The local dev account AUTH_DISABLED runs as, created on first use. */
  localDevAccount: () => Promise<{ userId: string; username: string; displayName: string }>;
  createSession: (data: {
    userId: string;
    identityId: string;
    expiresAt: Date;
    userAgent: string | null;
  }) => Promise<{ id: string }>;
  findActiveSession: FindActiveSession;
  /** Any session row, to say why a cookie no longer signs in. */
  findSession: FindSession;
  /** Note a session was used now; must not throw or wait. */
  markSessionSeen: (sid: string) => void;
  listActiveSessions: (userId: string) => Promise<StudioSessionRecord[]>;
  revokeSession: (id: string, userId: string) => Promise<boolean>;
  revokeAllSessions: (userId: string) => Promise<number>;
  /** Drop sessions that ended before `olderThan`, see pruneStudioSessions. */
  pruneSessions: (userId: string, olderThan: Date) => Promise<void>;
}

// ended sessions stay listed nowhere, but keep their rows a while for audit
export const ENDED_SESSION_RETENTION_MS = 30 * 24 * 3600 * 1000;

export function createAuthRoutes(deps: AuthRouteDeps): Router {
  const router = Router();

  const currentSession = async (
    req: Request,
  ): Promise<{ session: ActiveSession; account: Account } | null> =>
    resolveSession(req.headers.cookie, {
      secret: env.SESSION_SECRET,
      findActiveSession: deps.findActiveSession,
      getAccount: deps.getAccount,
      markSeen: deps.markSessionSeen,
    });

  const notSignedIn = async (req: Request) =>
    new AppError(401, 'Not signed in', undefined, {
      reason: await whySessionEnded(req.headers.cookie, {
        secret: env.SESSION_SECRET,
        findSession: deps.findSession,
        getAccount: deps.getAccount,
      }),
    });

  /** The caller's live session, or a 401. Only a Studio session, never a key. */
  const requireSession = async (req: Request) => {
    if (env.AUTH_DISABLED) {
      throw new AppError(409, 'Sign-in is disabled on this server, so there are no sessions');
    }
    const current = await currentSession(req);
    if (!current) throw await notSignedIn(req);
    return current;
  };

  /** The provider named in the path, or null after answering 404 for an unknown one. */
  const providerOf = (req: Request, res: Response): SignInProvider | null => {
    const provider = getProvider(String(req.params.provider));
    // answered here rather than passed on, or the request would reach the
    // api-key check below and read as a missing key instead of a bad path
    if (!provider) res.status(404).json({ error: 'No such sign-in provider' });
    return provider ?? null;
  };

  /**
   * GET /api/v1/auth/:provider/login
   * Starts a sign-in: remembers a fresh state and where to land afterwards in
   * this browser's handshake cookie, and sends the browser to the provider.
   */
  router.get('/:provider/login', (req: Request, res: Response) => {
    const provider = providerOf(req, res);
    if (!provider) return;
    if (!provider.isConfigured()) {
      // a browser follows this link, so send it to a page that says why
      signInFailed(res, 'not_configured');
      return;
    }
    const handshake: Handshake = {
      provider: provider.id,
      issuedAt: Math.floor(Date.now() / 1000),
      state: crypto.randomBytes(24).toString('base64url'),
      next: safeRedirectPath(req.query.next),
    };
    res.setHeader('Set-Cookie', handshakeCookie(encodeHandshake(handshake), HANDSHAKE_TTL_SEC));
    res.redirect(
      provider.authorizationUrl({ state: handshake.state, callbackUrl: callbackUrl(provider) }),
    );
  });

  /**
   * GET /api/v1/auth/:provider/callback
   * Finishes a sign-in started in this browser: checks the state against the
   * handshake cookie, lets the provider verify the person, applies the
   * allowlist, signs the account in and redirects into the Studio.
   */
  router.get('/:provider/callback', async (req: Request, res: Response) => {
    const provider = providerOf(req, res);
    if (!provider) return;

    // the handshake is single use whatever happens next
    const clear = handshakeCookie('', 0);
    res.setHeader('Set-Cookie', clear);

    if (!provider.isConfigured()) {
      signInFailed(res, 'not_configured');
      return;
    }

    const handshake = decodeHandshake(parseCookieHeader(req.headers.cookie)[HANDSHAKE_COOKIE]);
    const state = req.query.state;
    const age = handshake ? Math.floor(Date.now() / 1000) - handshake.issuedAt : -1;
    if (
      !handshake ||
      handshake.provider !== provider.id ||
      age < 0 ||
      age > HANDSHAKE_TTL_SEC ||
      typeof state !== 'string' ||
      !sameState(state, handshake.state)
    ) {
      signInFailed(res, 'expired_handshake');
      return;
    }

    try {
      const profile = await provider.completeSignIn(req.query as Record<string, unknown>, {
        callbackUrl: callbackUrl(provider),
      });

      const allowlist = provider.allowlist();
      const operators = operatorAllowlist(provider);
      const result = await deps.signIn({
        provider: provider.id,
        subject: profile.subject,
        username: profile.username,
        displayName: profile.displayName,
        legacyAddress: provider.legacyOwnerAddress?.(profile),
        decide: (pins) => {
          const decision = allowlist.atSignIn(profile.subject, profile.username, pins);
          if (!decision.allowed) return decision;
          // an operator handle entry is pinned the same way, in the same
          // table; both lists normalise the handle alike, so it is one entry
          const operatorPin = operators?.atSignIn(profile.subject, profile.username, pins).pin;
          return { allowed: true, pin: decision.pin ?? operatorPin };
        },
      });
      if (result.status === 'refused') {
        logger.warn(
          { provider: provider.id, subject: profile.subject, username: profile.username },
          'Sign-in refused by the allowlist',
        );
        signInFailed(res, 'not_allowed', profile.username);
        return;
      }

      await deps.pruneSessions(result.userId, new Date(Date.now() - ENDED_SESSION_RETENTION_MS));
      const userAgent = req.headers['user-agent'];
      const session = await deps.createSession({
        userId: result.userId,
        identityId: result.identityId,
        expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
      });
      const token = signSession(session.id, result.userId, env.SESSION_SECRET);
      res.setHeader('Set-Cookie', [
        buildSessionCookie(token, { maxAgeSec: SESSION_TTL_SEC, secure: isSecure() }),
        clear,
      ]);
      // checked again: the cookie came back from the browser
      res.redirect(safeRedirectPath(handshake.next));
    } catch (e) {
      if (e instanceof SignInError) {
        if (e.reason !== 'cancelled') {
          logger.warn({ err: e, provider: provider.id }, 'Sign-in did not complete');
        }
        signInFailed(res, e.reason === 'cancelled' ? 'cancelled' : 'provider_failed');
        return;
      }
      logger.error({ err: e, provider: provider.id }, 'Sign-in callback failed');
      signInFailed(res, 'provider_failed');
    }
  });

  /**
   * GET /api/v1/auth/me
   * The signed-in account: its id and display name, the provider and handle
   * the browser signed in with, and whether it is an operator. 401 when not
   * signed in. The Studio calls this on load to decide whether to show the
   * sign-in screen, and which operator views to show.
   */
  router.get('/me', async (req: Request, res: Response) => {
    // snake_case and an ISO expiry like the rest of the api; the camelCase
    // fields stay one more release because the Studio still reads them
    if (env.AUTH_DISABLED) {
      const dev = await deps.localDevAccount();
      res.json({
        id: dev.userId,
        name: dev.displayName,
        username: dev.username,
        provider: 'local',
        provider_label: 'Local',
        auth_disabled: true,
        // the one local user runs the deployment, as resolveCaller treats it
        operator: true,
        expires_at: null,
        providerLabel: 'Local',
        authDisabled: true,
      });
      return;
    }
    const current = await currentSession(req);
    if (!current) throw await notSignedIn(req);
    const { session, account } = current;
    const identity = account.identities.find((i) => i.id === session.identityId);
    const providerLabel = (identity && getProvider(identity.provider)?.label) ?? null;
    res.json({
      id: account.id,
      name: account.displayName,
      username: identity?.username ?? account.displayName,
      provider: identity?.provider ?? null,
      provider_label: providerLabel,
      auth_disabled: false,
      operator: isOperatorAccount(account),
      expires_at: session.expiresAt.toISOString(),
      providerLabel,
      expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
    });
  });

  /**
   * POST /api/v1/auth/logout
   * Ends the current session server-side and clears the cookie.
   */
  router.post('/logout', async (req: Request, res: Response) => {
    const current = await currentSession(req);
    if (current) await deps.revokeSession(current.session.id, current.session.userId);
    res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true });
  });

  /**
   * GET /api/v1/auth/sessions
   * The signed-in account's live sessions, newest first, marking the current one.
   */
  router.get('/sessions', async (req: Request, res: Response) => {
    const { session } = await requireSession(req);
    const rows = await deps.listActiveSessions(session.userId);
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        user_agent: r.userAgent,
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
        last_seen_at: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
        current: r.id === session.id,
      })),
    });
  });

  /**
   * DELETE /api/v1/auth/sessions/:id
   * Ends one of the signed-in account's sessions. Ending the current one also
   * clears its cookie.
   */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    const { session } = await requireSession(req);
    const id = String(req.params.id);
    if (!(await deps.revokeSession(id, session.userId))) {
      throw new AppError(404, 'Session not found');
    }
    if (id === session.id) res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true });
  });

  /**
   * DELETE /api/v1/auth/sessions
   * Signs the account out everywhere, this browser included. API keys are
   * not touched: they are revoked from the keys page.
   */
  router.delete('/sessions', async (req: Request, res: Response) => {
    const { session } = await requireSession(req);
    const revoked = await deps.revokeAllSessions(session.userId);
    res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true, revoked });
  });

  return router;
}

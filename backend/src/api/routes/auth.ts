import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../middleware/error-handler.js';
import { emailSchema, parseOrThrow, personNameSchema } from '../validation.js';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password.js';
import { sameSetupCode } from '../auth/setup-code.js';
import { AttemptLimiter } from '../auth/attempts.js';
import { hashLinkToken, isLinkToken, linkGone, type LinkGone } from '../auth/link-token.js';
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
import { getProvider, SignInError, type SignInProvider } from '../auth/providers/index.js';
import type {
  ChangeEmailResult,
  FirstAdminResult,
  LinkIdentityResult,
  PasswordAccount,
  PasswordAccountInput,
  SignInInput,
  SignInResult,
  UnlinkIdentityResult,
} from '../../db/queries/accounts.js';
import type {
  AcceptInviteResult,
  AcceptResetResult,
  JoinWithIdentityResult,
  LinkRecord,
} from '../../db/queries/invites.js';

function isSecure(): boolean {
  return env.PUBLIC_URL.startsWith('https://');
}

function callbackUrl(provider: SignInProvider): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/api/v1/auth/${provider.id}/callback`;
}

const DEFAULT_LANDING = '/studio';

/**
 * Why a sign-in did not finish, as the Studio reads it from `signin_error`:
 * - `expired_handshake`: the handshake expired or came from another browser
 * - `not_a_member`: nobody added this provider account; `disabled`: an admin
 *   removed its member
 * - `already_linked`: joining or linking with a provider account that
 *   already belongs to a member
 * - `not_signed_in`: linking was started or finished without a session of
 *   the account it was for
 * - `invite_not_found`, `invite_used`, `invite_expired`, `invite_revoked`:
 *   joining with an invite that does not work
 * - `cancelled` at the provider, `provider_failed`, or `not_configured` on
 *   this server
 */
export type SignInFailure =
  | 'expired_handshake'
  | 'not_a_member'
  | 'disabled'
  | 'already_linked'
  | 'not_signed_in'
  | 'invite_not_found'
  | `invite_${LinkGone}`
  | 'cancelled'
  | 'provider_failed'
  | 'not_configured';

/**
 * Send the browser back to the Studio with the failure in the query, so it
 * can explain it on its own sign-in screen. `handle` is the provider login
 * that was refused; the Studio must show it as text, never as markup. When
 * the handshake survived, `next` is where the sign-in started, so trying
 * again from that screen still lands on the page the person wanted.
 */
function signInFailed(
  res: Response,
  code: SignInFailure,
  opts: { handle?: string; next?: string } = {},
): void {
  const url = new URL(safeRedirectPath(opts.next), env.PUBLIC_URL);
  url.searchParams.set('signin_error', code);
  if (opts.handle !== undefined) url.searchParams.set('handle', opts.handle);
  res.set('Cache-Control', 'no-store').redirect(`${url.pathname}${url.search}${url.hash}`);
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

/**
 * What the sign-in is for: signing a member in, joining with an invite (the
 * token travels in the cookie, never through the provider), or adding the
 * provider account to the signed-in member `userId`.
 */
type Intent =
  { kind: 'sign_in' } | { kind: 'invite'; token: string } | { kind: 'link'; userId: string };

interface Handshake {
  provider: string;
  issuedAt: number;
  state: string;
  next: string;
  intent: Intent;
}

function encodeIntent(intent: Intent): string {
  const raw =
    intent.kind === 'invite'
      ? `invite:${intent.token}`
      : intent.kind === 'link'
        ? `link:${intent.userId}`
        : 'sign_in';
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeIntent(value: string | undefined): Intent | null {
  // a handshake begun before intents existed is a plain sign-in
  if (value === undefined) return { kind: 'sign_in' };
  const raw = Buffer.from(value, 'base64url').toString('utf8');
  if (raw === 'sign_in') return { kind: 'sign_in' };
  const colon = raw.indexOf(':');
  const kind = raw.slice(0, colon);
  const rest = raw.slice(colon + 1);
  if (colon === -1 || !rest) return null;
  if (kind === 'invite') return { kind: 'invite', token: rest };
  if (kind === 'link') return { kind: 'link', userId: rest };
  return null;
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
  return `${h.provider}.${h.issuedAt}.${h.state}.${next}.${encodeIntent(h.intent)}`;
}

function decodeHandshake(value: string | undefined): Handshake | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [provider, issuedAt, state, next, intentPart] = parts;
  const issued = Number(issuedAt);
  const intent = decodeIntent(intentPart);
  if (!provider || !state || !Number.isSafeInteger(issued) || !intent) return null;
  return {
    provider,
    issuedAt: issued,
    state,
    next: Buffer.from(next, 'base64url').toString('utf8'),
    intent,
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
  /** Sign in a member's identity, refusing anyone else, see signInIdentity. */
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
  /** End every live session of the account but `keepId`, returning how many. */
  revokeOtherSessions: (userId: string, keepId: string) => Promise<number>;
  /** Drop sessions that ended before `olderThan`, see pruneStudioSessions. */
  pruneSessions: (userId: string, olderThan: Date) => Promise<void>;

  /** Whether an admin who can sign in exists; until one does, setup is open. */
  hasSignInAdmin: () => Promise<boolean>;
  createFirstAdmin: (input: PasswordAccountInput) => Promise<FirstAdminResult>;
  /** The account that signs in with this (lowercased) email, or null. */
  findPasswordAccount: (email: string) => Promise<PasswordAccount | null>;
  /** Note a sign-in through an identity. */
  recordSignIn: (identityId: string) => Promise<void>;
  getPasswordCredential: (
    userId: string,
  ) => Promise<{ email: string; passwordHash: string } | null>;
  setPassword: (userId: string, passwordHash: string) => Promise<void>;
  /** Rename an account; false when there is none. */
  setDisplayName: (userId: string, name: string) => Promise<boolean>;
  /** Change the email an account signs in with, see changeSignInEmail. */
  changeSignInEmail: (userId: string, email: string) => Promise<ChangeEmailResult>;
  /** Take a provider's identity off an account, see unlinkIdentity. */
  unlinkIdentity: (userId: string, provider: string) => Promise<UnlinkIdentityResult>;
  linkIdentity: (
    userId: string,
    input: Omit<SignInInput, 'displayName'>,
  ) => Promise<LinkIdentityResult>;
  /** The invite or reset link with this token hash, or null. */
  findLink: (tokenHash: string) => Promise<LinkRecord | null>;
  acceptInvite: (tokenHash: string, input: PasswordAccountInput) => Promise<AcceptInviteResult>;
  acceptReset: (
    tokenHash: string,
    input: { email: string | null; passwordHash: string },
  ) => Promise<AcceptResetResult>;
  joinWithIdentity: (tokenHash: string, input: SignInInput) => Promise<JoinWithIdentityResult>;
}

/**
 * Failed and repeated attempts at the routes that take a secret, per client
 * address and per email, in this process's memory (see attempts.ts).
 */
export interface AuthAttemptLimits {
  /** Password sign-ins and changes from one address: every attempt counts. */
  passwordPerIp: AttemptLimiter;
  /** Wrong passwords for one email, wherever they come from. */
  passwordPerEmail: AttemptLimiter;
  /** Setup attempts from one address. */
  setupPerIp: AttemptLimiter;
  /** Invite and reset link lookups and uses from one address. */
  linkPerIp: AttemptLimiter;
}

export function authAttemptLimits(): AuthAttemptLimits {
  const minutes = (n: number) => n * 60_000;
  return {
    passwordPerIp: new AttemptLimiter({ limit: 10, windowMs: minutes(10) }),
    passwordPerEmail: new AttemptLimiter({ limit: 5, windowMs: minutes(15) }),
    setupPerIp: new AttemptLimiter({ limit: 10, windowMs: minutes(10) }),
    linkPerIp: new AttemptLimiter({ limit: 30, windowMs: minutes(10) }),
  };
}

// ended sessions stay listed nowhere, but keep their rows a while for audit
export const ENDED_SESSION_RETENTION_MS = 30 * 24 * 3600 * 1000;

/** How the Studio names the ways to sign in. */
function providerLabel(provider: string): string | null {
  if (provider === 'password') return 'Password';
  return getProvider(provider)?.label ?? null;
}

// a wrong sign-in password is a 401 with a fixed message, whichever part was wrong
const signInBodySchema = z
  .object({
    email: z.string({ message: 'email must be a string' }).trim().toLowerCase().min(1, {
      message: 'Enter your email address.',
    }),
    password: z
      .string({ message: 'password must be a string' })
      .min(1, { message: 'Enter your password.' })
      .max(1024, { message: 'That password is too long.' }),
  })
  .strict();

/** A password someone is choosing now, held to passwordProblem. */
const newPasswordSchema = z
  .string({ message: 'password must be a string' })
  .superRefine((pw, ctx) => {
    const problem = passwordProblem(pw);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const setupBodySchema = z
  .object({
    code: z
      .string({ message: 'code must be a string' })
      .min(1, { message: 'Enter the setup code.' }),
    name: personNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
  })
  .strict();

const inviteAcceptSchema = z
  .object({ name: personNameSchema, email: emailSchema, password: newPasswordSchema })
  .strict();

const resetAcceptSchema = z
  .object({ password: newPasswordSchema, email: emailSchema.optional() })
  .strict();

const renameSchema = z.object({ name: personNameSchema }).strict();

const changeEmailSchema = z
  .object({
    email: emailSchema,
    current_password: z
      .string({ message: 'current_password must be a string' })
      .min(1, { message: 'Enter your current password.' })
      .max(1024, { message: 'That password is too long.' }),
  })
  .strict();

const changePasswordSchema = z
  .object({
    current_password: z
      .string({ message: 'current_password must be a string' })
      .min(1, { message: 'Enter your current password.' })
      .max(1024, { message: 'That password is too long.' }),
    new_password: newPasswordSchema,
  })
  .strict();

export function createAuthRoutes(
  deps: AuthRouteDeps,
  limits: AuthAttemptLimits = authAttemptLimits(),
): Router {
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

  /** The routes that sign people in have nothing to do while sign-in is off. */
  const requireSignInOn = () => {
    if (env.AUTH_DISABLED) {
      throw new AppError(409, 'Sign-in is disabled on this server');
    }
  };

  /**
   * Count an attempt against `key`, or answer 429 when its window is full.
   * The header and body match the api's other rate limit.
   */
  const spendAttempt = (res: Response, limiter: AttemptLimiter, key: string) => {
    const check = limiter.check(key);
    if (!check.ok) throw tooManyAttempts(res, check.retryAfterSec);
    limiter.fail(key);
  };

  const tooManyAttempts = (res: Response, retryAfterSec: number) => {
    res.set('Retry-After', String(retryAfterSec));
    const minutes = Math.ceil(retryAfterSec / 60);
    return new AppError(
      429,
      `Too many attempts. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`,
      undefined,
      { retry_after: retryAfterSec },
    );
  };

  const clientIp = (req: Request) => req.ip ?? 'unknown';

  /**
   * Start a session for the account and set its cookie, with any other
   * cookies the response sets.
   */
  const startSession = async (
    req: Request,
    res: Response,
    account: { userId: string; identityId: string },
    otherCookies: string[] = [],
  ) => {
    await deps.pruneSessions(account.userId, new Date(Date.now() - ENDED_SESSION_RETENTION_MS));
    const userAgent = req.headers['user-agent'];
    const session = await deps.createSession({
      userId: account.userId,
      identityId: account.identityId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000),
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
    });
    const token = signSession(session.id, account.userId, env.SESSION_SECRET);
    res.setHeader('Set-Cookie', [
      buildSessionCookie(token, { maxAgeSec: SESSION_TTL_SEC, secure: isSecure() }),
      ...otherCookies,
    ]);
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
   * GET /api/v1/auth/config
   * What the sign-in screen needs before anyone is signed in: whether sign-in
   * is off, whether the first admin still has to be set up, and the ways to
   * sign in.
   */
  router.get('/config', async (_req: Request, res: Response) => {
    const setupRequired = env.AUTH_DISABLED ? false : !(await deps.hasSignInAdmin());
    res.set('Cache-Control', 'no-store').json({
      auth_disabled: env.AUTH_DISABLED,
      setup_required: setupRequired,
      methods: { password: true, github: getProvider('github')?.isConfigured() ?? false },
    });
  });

  /**
   * POST /api/v1/auth/setup
   * Make the first admin with the setup code from the server log, and sign
   * them in. Refused once an admin who can sign in exists.
   */
  router.post('/setup', async (req: Request, res: Response) => {
    requireSignInOn();
    spendAttempt(res, limits.setupPerIp, clientIp(req));
    const body = parseOrThrow(setupBodySchema, req.body ?? {});
    if (!sameSetupCode(body.code, env.SESSION_SECRET)) {
      const message = 'That setup code is wrong. Copy it from the server log.';
      throw new AppError(403, message, [{ field: 'code', message }], { reason: 'bad_code' });
    }
    const passwordHash = await hashPassword(body.password);
    const result = await deps.createFirstAdmin({
      name: body.name,
      email: body.email,
      passwordHash,
    });
    if (result.status === 'admin_exists') {
      throw new AppError(409, 'This server already has an admin. Sign in instead.', undefined, {
        reason: 'already_set_up',
      });
    }
    if (result.status === 'email_taken') throw emailTaken();
    logger.info({ userId: result.userId }, 'First admin set up');
    await startSession(req, res, result);
    res.status(201).json({ success: true });
  });

  /**
   * POST /api/v1/auth/password
   * Sign in with an email and password.
   */
  router.post('/password', async (req: Request, res: Response) => {
    requireSignInOn();
    spendAttempt(res, limits.passwordPerIp, clientIp(req));
    const body = parseOrThrow(signInBodySchema, req.body ?? {});
    const perEmail = limits.passwordPerEmail.check(body.email);
    if (!perEmail.ok) throw tooManyAttempts(res, perEmail.retryAfterSec);

    const account = await deps.findPasswordAccount(body.email);
    // an unknown email still costs a full hash, so timing does not tell
    const ok = await verifyPassword(body.password, account?.passwordHash ?? null);
    if (!ok || !account) {
      limits.passwordPerEmail.fail(body.email);
      throw new AppError(401, 'Wrong email or password', undefined, {
        reason: 'bad_credentials',
      });
    }
    limits.passwordPerEmail.reset(body.email);
    if (account.disabled) {
      throw new AppError(403, 'This account was removed from this workspace', undefined, {
        reason: 'disabled',
      });
    }
    await deps.recordSignIn(account.identityId);
    await startSession(req, res, account);
    res.json({ success: true });
  });

  /**
   * POST /api/v1/auth/password/change
   * Change the signed-in member's password. Every other session of the
   * account ends; this one stays.
   */
  router.post('/password/change', async (req: Request, res: Response) => {
    const { session, account } = await requireSession(req);
    spendAttempt(res, limits.passwordPerIp, clientIp(req));
    const body = parseOrThrow(changePasswordSchema, req.body ?? {});
    const credential = await deps.getPasswordCredential(account.id);
    if (!credential) {
      throw new AppError(
        409,
        'This account has no password yet. Ask an admin for a reset link to set one.',
        undefined,
        { reason: 'no_password' },
      );
    }
    const perEmail = limits.passwordPerEmail.check(credential.email);
    if (!perEmail.ok) throw tooManyAttempts(res, perEmail.retryAfterSec);
    if (!(await verifyPassword(body.current_password, credential.passwordHash))) {
      limits.passwordPerEmail.fail(credential.email);
      const message = 'Your current password is wrong.';
      throw new AppError(403, message, [{ field: 'current_password', message }], {
        reason: 'bad_credentials',
      });
    }
    limits.passwordPerEmail.reset(credential.email);
    await deps.setPassword(account.id, await hashPassword(body.new_password));
    const revoked = await deps.revokeOtherSessions(account.id, session.id);
    res.json({ success: true, revoked });
  });

  /**
   * PATCH /api/v1/auth/me
   * Change the signed-in member's name, as the members list and the Studio
   * show it.
   */
  router.patch('/me', async (req: Request, res: Response) => {
    const { account } = await requireSession(req);
    const body = parseOrThrow(renameSchema, req.body ?? {});
    if (!(await deps.setDisplayName(account.id, body.name))) throw await notSignedIn(req);
    res.json({ name: body.name });
  });

  /**
   * POST /api/v1/auth/email/change
   * Change the email the signed-in member signs in with. Needs their current
   * password, like a password change; the password itself stays.
   */
  router.post('/email/change', async (req: Request, res: Response) => {
    const { account } = await requireSession(req);
    spendAttempt(res, limits.passwordPerIp, clientIp(req));
    const body = parseOrThrow(changeEmailSchema, req.body ?? {});
    const credential = await deps.getPasswordCredential(account.id);
    if (!credential) {
      throw new AppError(
        409,
        'This account has no password yet. Ask an admin for a reset link to set one.',
        undefined,
        { reason: 'no_password' },
      );
    }
    const perEmail = limits.passwordPerEmail.check(credential.email);
    if (!perEmail.ok) throw tooManyAttempts(res, perEmail.retryAfterSec);
    if (!(await verifyPassword(body.current_password, credential.passwordHash))) {
      limits.passwordPerEmail.fail(credential.email);
      const message = 'Your current password is wrong.';
      throw new AppError(403, message, [{ field: 'current_password', message }], {
        reason: 'bad_credentials',
      });
    }
    limits.passwordPerEmail.reset(credential.email);
    const result = await deps.changeSignInEmail(account.id, body.email);
    if (result === 'email_taken') throw emailTaken();
    if (result === 'no_password') {
      throw new AppError(409, 'This account has no password yet.', undefined, {
        reason: 'no_password',
      });
    }
    res.json({ email: body.email });
  });

  /**
   * DELETE /api/v1/auth/identities/:provider
   * Stop signing in with a provider such as GitHub. Refused for the way this
   * browser signed in, and for the account's only way to sign in. An email
   * and password are changed, not removed.
   */
  router.delete('/identities/:provider', async (req: Request, res: Response) => {
    const { session, account } = await requireSession(req);
    const provider = String(req.params.provider);
    if (!getProvider(provider)) throw new AppError(404, 'No such sign-in provider');
    const identity = account.identities.find((i) => i.provider === provider);
    if (!identity) throw new AppError(404, 'This account does not sign in with that provider');
    if (identity.id === session.identityId) {
      throw new AppError(
        409,
        `You signed in with ${providerLabel(provider) ?? provider} in this browser. Sign in another way to remove it.`,
        undefined,
        { reason: 'current_sign_in' },
      );
    }
    const result = await deps.unlinkIdentity(account.id, provider);
    if (result.status === 'not_found') {
      throw new AppError(404, 'This account does not sign in with that provider');
    }
    if (result.status === 'last') {
      throw new AppError(
        409,
        'This is your only way to sign in. Add another before removing it.',
        undefined,
        { reason: 'last_sign_in' },
      );
    }
    res.json({ success: true });
  });

  /**
   * The usable invite or reset link behind the token in the path, or the
   * error that says why it does not work.
   */
  const usableLink = async (req: Request, res: Response) => {
    requireSignInOn();
    spendAttempt(res, limits.linkPerIp, clientIp(req));
    const token = req.params.token;
    const link = isLinkToken(token) ? await deps.findLink(hashLinkToken(token)) : null;
    if (!link) throw linkNotFound();
    const gone = linkGone(link);
    if (gone) throw linkIsGone(gone);
    if (link.kind === 'reset' && link.userDisabled) throw removedMember();
    return { link, tokenHash: hashLinkToken(token as string) };
  };

  /**
   * GET /api/v1/auth/invites/:token
   * What an invite or reset link is for, so its page can show the right form.
   */
  router.get('/invites/:token', async (req: Request, res: Response) => {
    const { link } = await usableLink(req, res);
    res.set('Cache-Control', 'no-store').json({
      kind: link.kind,
      ...(link.kind === 'invite' ? { role: link.role ?? 'member' } : { email: link.email }),
      expires_at: link.expiresAt.toISOString(),
      github: getProvider('github')?.isConfigured() ?? false,
    });
  });

  /**
   * POST /api/v1/auth/invites/:token/accept
   * Use an invite (a new member with an email and password) or a reset link
   * (a new password, which ends the member's other sessions), and sign in.
   */
  router.post('/invites/:token/accept', async (req: Request, res: Response) => {
    const { link, tokenHash } = await usableLink(req, res);
    if (link.kind === 'invite') {
      const body = parseOrThrow(inviteAcceptSchema, req.body ?? {});
      const passwordHash = await hashPassword(body.password);
      const result = await deps.acceptInvite(tokenHash, { ...body, passwordHash });
      if (result.status === 'email_taken') throw emailTaken();
      if (result.status !== 'joined') throw refusedLink(result);
      logger.info({ userId: result.userId }, 'A member joined with an invite');
      await startSession(req, res, result);
      res.status(201).json({ success: true });
      return;
    }

    const body = parseOrThrow(resetAcceptSchema, req.body ?? {});
    if (link.email === null && body.email === undefined) {
      const message = 'Enter the email address you will sign in with.';
      throw new AppError(400, `email: ${message}`, [{ field: 'email', message }]);
    }
    if (link.email !== null && body.email !== undefined && body.email !== link.email) {
      const message = 'This account already signs in with another email. Leave email out.';
      throw new AppError(400, `email: ${message}`, [{ field: 'email', message }]);
    }
    const passwordHash = await hashPassword(body.password);
    const result = await deps.acceptReset(tokenHash, {
      email: link.email === null ? (body.email ?? null) : null,
      passwordHash,
    });
    if (result.status === 'email_taken') throw emailTaken();
    if (result.status === 'disabled') throw removedMember();
    if (result.status !== 'reset') throw refusedLink(result);
    logger.info({ userId: result.userId }, 'A member set a password from a reset link');
    await startSession(req, res, result);
    res.json({ success: true });
  });

  /**
   * GET /api/v1/auth/:provider/login
   * Starts a sign-in: remembers a fresh state, where to land afterwards and
   * what the sign-in is for in this browser's handshake cookie, and sends the
   * browser to the provider. `?invite=<token>` joins with an invite;
   * `?link=1` adds the provider account to the signed-in member.
   */
  router.get('/:provider/login', async (req: Request, res: Response) => {
    const provider = providerOf(req, res);
    if (!provider) return;
    const next = safeRedirectPath(req.query.next);
    if (!provider.isConfigured()) {
      // a browser follows this link, so send it to a page that says why
      signInFailed(res, 'not_configured');
      return;
    }
    let intent: Intent = { kind: 'sign_in' };
    if (req.query.invite !== undefined) {
      if (!isLinkToken(req.query.invite)) {
        signInFailed(res, 'invite_not_found', { next });
        return;
      }
      intent = { kind: 'invite', token: req.query.invite };
    } else if (req.query.link === '1') {
      const current = env.AUTH_DISABLED ? null : await currentSession(req);
      if (!current) {
        signInFailed(res, 'not_signed_in', { next });
        return;
      }
      intent = { kind: 'link', userId: current.account.id };
    }
    const handshake: Handshake = {
      provider: provider.id,
      issuedAt: Math.floor(Date.now() / 1000),
      state: crypto.randomBytes(24).toString('base64url'),
      next,
      intent,
    };
    res.setHeader('Set-Cookie', handshakeCookie(encodeHandshake(handshake), HANDSHAKE_TTL_SEC));
    res.redirect(
      provider.authorizationUrl({ state: handshake.state, callbackUrl: callbackUrl(provider) }),
    );
  });

  /**
   * GET /api/v1/auth/:provider/callback
   * Finishes a sign-in started in this browser: checks the state against the
   * handshake cookie, lets the provider verify the person, then signs the
   * member in, joins them with the invite, or links the account, and
   * redirects into the Studio.
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
    const { next, intent } = handshake;

    try {
      const profile = await provider.completeSignIn(req.query as Record<string, unknown>, {
        callbackUrl: callbackUrl(provider),
      });
      const input: SignInInput = {
        provider: provider.id,
        subject: profile.subject,
        username: profile.username,
        displayName: profile.displayName,
      };
      const refuse = (code: SignInFailure) => {
        logger.warn(
          { provider: provider.id, subject: profile.subject, username: profile.username, code },
          'Sign-in refused',
        );
        signInFailed(res, code, { handle: profile.username, next });
      };

      if (intent.kind === 'link') {
        const current = await currentSession(req);
        if (!current || current.account.id !== intent.userId) {
          refuse('not_signed_in');
          return;
        }
        const linked = await deps.linkIdentity(intent.userId, input);
        if (linked.status === 'already_linked') {
          refuse('already_linked');
          return;
        }
        logger.info({ userId: intent.userId, provider: provider.id }, 'Linked a sign-in method');
        res.redirect(safeRedirectPath(next));
        return;
      }

      let account: { userId: string; identityId: string };
      if (intent.kind === 'invite') {
        const joined = await deps.joinWithIdentity(hashLinkToken(intent.token), input);
        if (joined.status === 'not_found') return refuse('invite_not_found');
        if (joined.status === 'gone') return refuse(`invite_${joined.reason}`);
        if (joined.status === 'already_linked') return refuse('already_linked');
        logger.info(
          { userId: joined.userId, provider: provider.id },
          'A member joined with an invite',
        );
        account = joined;
      } else {
        const result = await deps.signIn(input);
        if (result.status === 'refused') return refuse(result.reason);
        account = result;
      }

      await startSession(req, res, account, [clear]);
      // checked again: the cookie came back from the browser
      res.redirect(safeRedirectPath(next));
    } catch (e) {
      if (e instanceof SignInError) {
        if (e.reason !== 'cancelled') {
          logger.warn({ err: e, provider: provider.id }, 'Sign-in did not complete');
        }
        signInFailed(res, e.reason === 'cancelled' ? 'cancelled' : 'provider_failed', { next });
        return;
      }
      logger.error({ err: e, provider: provider.id }, 'Sign-in callback failed');
      signInFailed(res, 'provider_failed', { next });
    }
  });

  /**
   * GET /api/v1/auth/me
   * The signed-in account: its id and display name, the provider and handle
   * the browser signed in with, its role and every way it signs in. 401 when
   * not signed in. The Studio calls this on load to decide whether to show
   * the sign-in screen, and which admin views to show.
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
        role: 'admin',
        // deprecated alias of role === 'admin', kept one release for older studios
        operator: true,
        sign_in: [{ provider: 'local', username: dev.username }],
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
    const label = identity ? providerLabel(identity.provider) : null;
    res.json({
      id: account.id,
      name: account.displayName,
      username: identity?.username ?? account.displayName,
      provider: identity?.provider ?? null,
      provider_label: label,
      auth_disabled: false,
      role: account.role,
      // deprecated alias of role === 'admin', kept one release for older studios
      operator: account.role === 'admin',
      sign_in: account.identities.map((i) => ({ provider: i.provider, username: i.username })),
      expires_at: session.expiresAt.toISOString(),
      providerLabel: label,
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

function emailTaken(): AppError {
  const message = 'Another account already signs in with this email.';
  return new AppError(409, message, [{ field: 'email', message }], { reason: 'email_taken' });
}

function linkNotFound(): AppError {
  return new AppError(404, 'This link does not exist. Ask an admin for a new one.');
}

function linkIsGone(reason: LinkGone): AppError {
  const why = {
    used: 'This link was already used.',
    expired: 'This link has expired.',
    revoked: 'This link was withdrawn.',
  }[reason];
  return new AppError(410, `${why} Ask an admin for a new one.`, undefined, { reason });
}

function refusedLink(result: { status: 'not_found' } | { status: 'gone'; reason: LinkGone }) {
  return result.status === 'not_found' ? linkNotFound() : linkIsGone(result.reason);
}

function removedMember(): AppError {
  return new AppError(403, 'This account was removed from this workspace', undefined, {
    reason: 'disabled',
  });
}

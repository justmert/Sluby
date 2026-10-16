import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../middleware/error-handler.js';
import {
  SESSION_TTL_SEC,
  buildClearCookie,
  buildSessionCookie,
  isLoginAllowed,
  parseCookieHeader,
  resolveSession,
  signSession,
  type ActiveSession,
  type FindActiveSession,
} from '../auth/session.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSecure(): boolean {
  return env.PUBLIC_URL.startsWith('https://');
}

function callbackUrl(): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/api/v1/auth/github/callback`;
}

/**
 * A tiny in-memory set of currently-valid OAuth `state` values. Each entry
 * lives for ~10 minutes; the callback verifies + consumes a state to
 * mitigate CSRF on the OAuth handshake.
 */
const PENDING_STATES = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(): string {
  const now = Date.now();
  // Opportunistic GC so the map stays bounded.
  for (const [k, exp] of PENDING_STATES) {
    if (exp < now) PENDING_STATES.delete(k);
  }
  const s = crypto.randomBytes(24).toString('base64url');
  PENDING_STATES.set(s, now + STATE_TTL_MS);
  return s;
}

function consumeState(s: string): boolean {
  const exp = PENDING_STATES.get(s);
  if (!exp) return false;
  PENDING_STATES.delete(s);
  return exp >= Date.now();
}

// ---------------------------------------------------------------------------
// GitHub API calls
// ---------------------------------------------------------------------------

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GithubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(),
    }),
  });
  const body = (await res.json()) as GithubTokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    throw new Error(`GitHub token exchange failed: ${body.error ?? res.statusText}`);
  }
  return body.access_token;
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'sluby',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user call failed: ${res.status}`);
  }
  return (await res.json()) as GithubUser;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface StudioSessionRecord {
  id: string;
  login: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthRouteDeps {
  createSession: (data: {
    login: string;
    expiresAt: Date;
    userAgent: string | null;
  }) => Promise<{ id: string }>;
  findActiveSession: FindActiveSession;
  listActiveSessions: (login: string) => Promise<StudioSessionRecord[]>;
  revokeSession: (id: string, login: string) => Promise<boolean>;
  revokeAllSessions: (login: string) => Promise<number>;
  /** Drop sessions that ended before `olderThan`, see pruneStudioSessions. */
  pruneSessions: (login: string, olderThan: Date) => Promise<void>;
}

// ended sessions stay listed nowhere, but keep their rows a while for audit
export const ENDED_SESSION_RETENTION_MS = 30 * 24 * 3600 * 1000;

export function createAuthRoutes(deps: AuthRouteDeps): Router {
  const router = Router();

  const currentSession = (req: Request): Promise<ActiveSession | null> =>
    resolveSession(req.headers.cookie, {
      secret: env.SESSION_SECRET,
      allowedUsers: env.GITHUB_ALLOWED_USERS,
      findActiveSession: deps.findActiveSession,
    });

  /** The caller's live session, or a 401. Only a Studio session, never a key. */
  const requireSession = async (req: Request): Promise<ActiveSession> => {
    if (env.AUTH_DISABLED) {
      throw new AppError(409, 'Sign-in is disabled on this server, so there are no sessions');
    }
    const session = await currentSession(req);
    if (!session) throw new AppError(401, 'Not signed in');
    return session;
  };

  /**
   * GET /api/v1/auth/github/login
   * Starts the OAuth handshake. Issues a state token, stashes it, and
   * 302s the browser to GitHub's consent page.
   */
  router.get('/github/login', (req: Request, res: Response) => {
    if (!env.GITHUB_CLIENT_ID) {
      res.status(500).json({ error: 'GitHub OAuth is not configured' });
      return;
    }
    const state = issueState();
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', callbackUrl());
    authUrl.searchParams.set('scope', 'read:user');
    authUrl.searchParams.set('state', state);

    // Optional per-request post-login redirect path (relative). The caller
    // can land users back where they started after auth completes.
    const next = String(req.query.next ?? '/studio');
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/studio';

    const nextCookie = [
      `sluby_login_next=${encodeURIComponent(safeNext)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${10 * 60}`,
    ];
    if (isSecure()) nextCookie.push('Secure');
    res.setHeader('Set-Cookie', nextCookie.join('; '));
    res.redirect(authUrl.toString());
  });

  /**
   * GET /api/v1/auth/github/callback?code=...&state=...
   * Exchanges the code for an access token, fetches the user's profile,
   * enforces the allowlist, issues a signed session cookie, and
   * redirects the browser back into the Studio.
   */
  router.get('/github/callback', async (req: Request, res: Response) => {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      res.status(500).send('GitHub OAuth is not configured');
      return;
    }

    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const err = req.query.error as string | undefined;

    if (err) {
      logger.warn({ err }, 'GitHub OAuth returned error');
      res.status(400).send(`GitHub login failed: ${err}`);
      return;
    }
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    if (!consumeState(state)) {
      res.status(400).send('Invalid or expired state');
      return;
    }

    try {
      const accessToken = await exchangeCodeForToken(code);
      const user = await fetchGithubUser(accessToken);

      // Allowlist enforcement is a runtime setting rather than commented-out
      // code: when GITHUB_ALLOWED_USERS lists any logins, only those may sign
      // in. Leaving it empty keeps sign-in open, which is what the public
      // review deployment wants; startup logs a warning in that case so an
      // open Studio is never a silent surprise.
      if (!isLoginAllowed(user.login, env.GITHUB_ALLOWED_USERS)) {
        logger.warn({ login: user.login }, 'GitHub user not in allowlist');
        res
          .status(403)
          .send(`Access denied: GitHub user "${user.login}" is not on the Studio allowlist.`);
        return;
      }

      await deps.pruneSessions(user.login, new Date(Date.now() - ENDED_SESSION_RETENTION_MS));
      const userAgent = req.headers['user-agent'];
      const session = await deps.createSession({
        login: user.login,
        expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
      });
      const token = signSession(session.id, user.login, env.SESSION_SECRET);
      const setCookies = [
        buildSessionCookie(token, {
          maxAgeSec: SESSION_TTL_SEC,
          secure: isSecure(),
        }),
      ];

      const cookies = parseCookieHeader(req.headers.cookie);
      const next = cookies['sluby_login_next'];
      const redirectTo = next && next.startsWith('/') && !next.startsWith('//') ? next : '/studio';

      // Clear the one-shot next cookie.
      const clearNext = ['sluby_login_next=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
      if (isSecure()) clearNext.push('Secure');
      setCookies.push(clearNext.join('; '));

      res.setHeader('Set-Cookie', setCookies);
      res.redirect(redirectTo);
    } catch (e) {
      logger.error({ err: e }, 'GitHub OAuth callback failed');
      res.status(500).send('GitHub login failed. Please try again.');
    }
  });

  /**
   * GET /api/v1/auth/me
   * Returns the current session's user profile. 401 when not signed in.
   * The Studio polls this on load to decide whether to show the sign-in
   * screen or the app.
   */
  router.get('/me', async (req: Request, res: Response) => {
    // snake_case and an ISO expiry like the rest of the api; the camelCase
    // fields stay one more release because the Studio still reads them
    if (env.AUTH_DISABLED) {
      res.json({ login: 'dev', auth_disabled: true, expires_at: null, authDisabled: true });
      return;
    }
    const session = await currentSession(req);
    if (!session) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    res.json({
      login: session.login,
      auth_disabled: false,
      expires_at: session.expiresAt.toISOString(),
      expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
    });
  });

  /**
   * POST /api/v1/auth/logout
   * Ends the current session server-side and clears the cookie.
   */
  router.post('/logout', async (req: Request, res: Response) => {
    const session = await currentSession(req);
    if (session) await deps.revokeSession(session.id, session.login);
    res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true });
  });

  /**
   * GET /api/v1/auth/sessions
   * The signed-in user's live sessions, newest first, marking the current one.
   */
  router.get('/sessions', async (req: Request, res: Response) => {
    const session = await requireSession(req);
    const rows = await deps.listActiveSessions(session.login);
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        user_agent: r.userAgent,
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
        current: r.id === session.id,
      })),
    });
  });

  /**
   * DELETE /api/v1/auth/sessions/:id
   * Ends one of the signed-in user's sessions. Ending the current one also
   * clears its cookie.
   */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    const session = await requireSession(req);
    const id = String(req.params.id);
    if (!(await deps.revokeSession(id, session.login))) {
      throw new AppError(404, 'Session not found');
    }
    if (id === session.id) res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true });
  });

  /**
   * DELETE /api/v1/auth/sessions
   * Signs the user out everywhere, this browser included.
   */
  router.delete('/sessions', async (req: Request, res: Response) => {
    const session = await requireSession(req);
    const revoked = await deps.revokeAllSessions(session.login);
    res.setHeader('Set-Cookie', buildClearCookie(isSecure()));
    res.json({ success: true, revoked });
  });

  return router;
}

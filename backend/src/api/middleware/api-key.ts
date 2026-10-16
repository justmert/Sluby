import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { resolveSession, type FindActiveSession } from '../auth/session.js';
import { hashApiKey } from '../auth/api-key.js';
import { isPlatformIdentity } from '../ownership.js';

export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  creatorAddress: string;
}

export interface ApiKeyMiddlewareDeps {
  findApiKeyByHash: (hash: string) => Promise<{
    id: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    creatorAddress: string;
    isActive: boolean;
    expiresAt: Date | null;
  } | null>;
  /** The live Studio session row for a session id, see resolveSession. */
  findActiveSession: FindActiveSession;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyInfo;
    }
  }
}

/**
 * Synthesise an ApiKeyInfo for a GitHub-authenticated Studio session.
 * The Studio UI doesn't manage its own API key — it trades the signed
 * session cookie for a virtual "manage"-scoped identity that lets it
 * exercise every REST endpoint exactly like a first-party SDK caller.
 */
function sessionIdentity(login: string): ApiKeyInfo {
  return {
    id: `session:${login}`,
    name: `GitHub session (${login})`,
    scopes: ['upload', 'read', 'manage'],
    rateLimit: 1000,
    creatorAddress: `github:${login.toLowerCase()}`,
  };
}

export function createApiKeyMiddleware(deps: ApiKeyMiddlewareDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Dev bypass: AUTH_DISABLED=true skips all auth checks and uses a
    // synthetic dev identity.
    if (env.AUTH_DISABLED) {
      req.apiKey = sessionIdentity('dev');
      next();
      return;
    }

    try {
      // 1) Session cookie path (Studio UI).
      const session = await resolveSession(req.headers.cookie, {
        secret: env.SESSION_SECRET,
        allowedUsers: env.GITHUB_ALLOWED_USERS,
        findActiveSession: deps.findActiveSession,
      });
      if (session) {
        req.apiKey = sessionIdentity(session.login);
        next();
        return;
      }

      // 2) API-key bearer path (SDK / programmatic callers).
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
      }

      const token = authHeader.slice(7);
      const hash = hashApiKey(token);

      const apiKey = await deps.findApiKeyByHash(hash);

      if (!apiKey) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      if (!apiKey.isActive) {
        res.status(401).json({ error: 'API key is deactivated' });
        return;
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        res.status(401).json({ error: 'API key has expired' });
        return;
      }

      req.apiKey = {
        id: apiKey.id,
        name: apiKey.name,
        scopes: apiKey.scopes,
        rateLimit: apiKey.rateLimit,
        creatorAddress: apiKey.creatorAddress,
      };

      next();
    } catch (err) {
      logger.error({ err }, 'Authentication check failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/** A scope-guard middleware, tagged with the scope it enforces. */
export interface ScopedMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  /** The scope this guard requires. Read by the OpenAPI drift test so the
   *  spec's `x-required-scope` cannot silently disagree with the code. */
  requiredScope?: string;
  /** Set when only the platform identity may pass, see requirePlatform. */
  requiredIdentity?: 'platform';
}

/**
 * Only the platform identity passes: deployment-wide operator data and
 * actions, which an ordinary tenant must not see or start.
 */
export function requirePlatform(): ScopedMiddleware {
  const middleware: ScopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!isPlatformIdentity(req.apiKey?.creatorAddress)) {
      res.status(403).json({ error: 'Only the platform identity may use this endpoint' });
      return;
    }
    next();
  };
  middleware.requiredIdentity = 'platform';
  return middleware;
}

/**
 * Middleware that checks if the API key has the required scope.
 */
export function requireScope(scope: string): ScopedMiddleware {
  const middleware: ScopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!req.apiKey.scopes.includes(scope)) {
      res.status(403).json({ error: `Requires '${scope}' scope` });
      return;
    }

    next();
  };

  middleware.requiredScope = scope;
  return middleware;
}

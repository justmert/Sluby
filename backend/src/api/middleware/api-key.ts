import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import {
  SESSION_COOKIE_NAME,
  parseCookieHeader,
  verifySession,
} from '../auth/session.js';

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

    // 1) Session cookie path (Studio UI).
    const cookies = parseCookieHeader(req.headers.cookie);
    const session = verifySession(cookies[SESSION_COOKIE_NAME], env.SESSION_SECRET);
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
    const hash = createHash('sha256').update(token).digest('hex');

    try {
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
      logger.error({ err }, 'API key validation error');
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Middleware that checks if the API key has the required scope.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
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
}

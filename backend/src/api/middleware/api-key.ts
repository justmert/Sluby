import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';
import { resolveCaller, type Caller, type CallerDeps } from '../auth/caller.js';
import { seesOperations } from '../ownership.js';

export type ApiKeyInfo = Caller;

export type ApiKeyMiddlewareDeps = CallerDeps;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyInfo;
    }
  }
}

/**
 * Authenticate every request below /api/v1 (except /auth and the public spec)
 * as a Studio session, the AUTH_DISABLED dev account or an API key, see
 * resolveCaller. The result is `req.apiKey`, whose creatorAddress (the
 * workspace) scopes every query and whose role decides what it may do.
 */
export function createApiKeyMiddleware(deps: ApiKeyMiddlewareDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await resolveCaller(
        { cookie: req.headers.cookie, authorization: req.headers.authorization },
        deps,
      );
      if (!result.ok) {
        res
          .status(401)
          .json({ error: result.error, ...(result.reason ? { reason: result.reason } : {}) });
        return;
      }
      req.apiKey = result.caller;
      next();
    } catch (err) {
      logger.error({ err }, 'Authentication check failed');
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

/** A scope-guard middleware, tagged with the scope it enforces. */
export interface ScopedMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  /** The scope this guard requires. Read by the OpenAPI drift test so the
   *  spec's `x-required-scope` cannot silently disagree with the code. */
  requiredScope?: string;
  /** Set when only an admin may pass, see requireAdmin. */
  requiredIdentity?: 'admin';
}

/**
 * Only an admin passes: deployment-wide operations data and actions, and
 * managing members, which a member must not see or start.
 */
export function requireAdmin(): ScopedMiddleware {
  const middleware: ScopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!seesOperations(req.apiKey)) {
      res.status(403).json({ error: 'Only an admin may use this endpoint' });
      return;
    }
    next();
  };
  middleware.requiredIdentity = 'admin';
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

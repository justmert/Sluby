import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';

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

export function createApiKeyMiddleware(deps: ApiKeyMiddlewareDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
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

import express, { Router } from 'express';
import { createUploadRoutes, type UploadRouteDeps } from './routes/uploads.js';
import { createAssetRoutes, type AssetRouteDeps } from './routes/assets.js';
import { createSiaInfoRoutes, type SiaInfoRouteDeps } from './routes/sia-info.js';
import { createPlaybackRoutes, type PlaybackRouteDeps } from './routes/playback.js';
import { createPlaybackIdRoutes, type PlaybackIdRouteDeps } from './routes/playback-ids.js';
import {
  createReconciliationRoutes,
  type ReconciliationRouteDeps,
} from './routes/reconciliation.js';
import { createWebhookRoutes, type WebhookRouteDeps } from './routes/webhooks.js';
import { createStatsRoutes, type StatsRouteDeps } from './routes/stats.js';
import { createKeyRoutes, type KeyRouteDeps } from './routes/keys.js';
import { createAuthRoutes, type AuthRouteDeps } from './routes/auth.js';
import {
  createApiKeyMiddleware,
  requirePlatform,
  requireScope,
  type ApiKeyMiddlewareDeps,
} from './middleware/api-key.js';
import { notFoundHandler } from './middleware/error-handler.js';
import { listRoutes } from './list-routes.js';
import { rateLimiter } from './rate-limiter.js';
import { getMetricsJson } from '../metrics/collector.js';
import { openapiDocument } from './openapi.js';
import { DOCS_ASSET_PATH, DOCS_HTML, SCALAR_ASSET_DIR } from './docs-page.js';
import type { NextFunction, Request, Response } from 'express';

export interface ApiRouterDeps
  extends
    UploadRouteDeps,
    AssetRouteDeps,
    SiaInfoRouteDeps,
    PlaybackRouteDeps,
    PlaybackIdRouteDeps,
    ReconciliationRouteDeps,
    WebhookRouteDeps,
    StatsRouteDeps,
    KeyRouteDeps,
    AuthRouteDeps,
    ApiKeyMiddlewareDeps {}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  // Auth routes run BEFORE the API-key middleware: they are the path by
  // which the browser obtains a session in the first place, and /auth/me
  // must be callable unauthenticated so the Studio can decide whether to
  // show the sign-in screen.
  router.use('/auth', createAuthRoutes(deps));

  // The API spec and its docs page are public (no key required) so tools
  // and humans can discover the contract before authenticating.
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openapiDocument);
  });
  router.get('/docs', (_req: Request, res: Response) => {
    res.type('html').send(DOCS_HTML);
  });
  // the reference page's script and its lazy chunks. a missing file is a 404
  // here rather than falling through to the api-key check (a 401)
  router.use(
    DOCS_ASSET_PATH,
    express.static(SCALAR_ASSET_DIR, { index: false, fallthrough: false }),
  );

  // A path no route serves is a 404 for everyone, as everywhere else; without
  // this the key check below answers an anonymous caller 401 first. The
  // route table is read once, after every route below is mounted.
  let knownRoutes: Array<{ method: string; pattern: RegExp }> | null = null;
  router.use((req: Request, res: Response, next: NextFunction) => {
    knownRoutes ??= listRoutes(router).map((r) => ({
      method: r.method,
      pattern: routePattern(r.path),
    }));
    // express answers HEAD with the GET route
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (knownRoutes.some((r) => r.method === method && r.pattern.test(req.path))) {
      next();
      return;
    }
    notFoundHandler(req, res);
  });

  // Apply middleware. Auth MUST run before the rate limiter: the limiter
  // buckets on req.apiKey.id and honours the key's own rateLimit, so if it
  // ran first every caller would fall back to the IP bucket and the generic
  // default limit, silently ignoring per-key limits.
  const apiKeyMiddleware = createApiKeyMiddleware(deps);
  router.use(apiKeyMiddleware);
  router.use(rateLimiter());

  // Mount route modules
  router.use('/uploads', createUploadRoutes(deps));
  router.use('/assets', createAssetRoutes(deps));
  router.use('/assets', createSiaInfoRoutes(deps));
  router.use('/playback', createPlaybackRoutes(deps));
  router.use('/webhooks', createWebhookRoutes(deps));
  // Playback-id and reconciliation routers own absolute paths
  // (/assets/:id/playback-ids, /playback-ids/:id, /reconciliation), so
  // they mount at the router root rather than a fixed prefix.
  router.use('/', createPlaybackIdRoutes(deps));
  router.use('/', createReconciliationRoutes(deps));
  router.use('/', createStatsRoutes(deps));

  router.use('/keys', createKeyRoutes(deps));

  // Metrics endpoint (JSON format). The registry counts the whole process,
  // every tenant together, so it is operator data.
  router.get(
    '/metrics',
    requireScope('read'),
    requirePlatform(),
    async (_req: Request, res: Response) => {
      const metrics = await getMetricsJson();
      res.json(metrics);
    },
  );

  return router;
}

/** A matcher for a route path from listRoutes, matching the way express does. */
function routePattern(path: string): RegExp {
  const escaped = path
    .split('/')
    .map((part) => (part === ':param' ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  // express routes are case-insensitive and allow one trailing slash
  return new RegExp(`^${escaped}/?$`, 'i');
}

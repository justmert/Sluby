import { Router } from 'express';
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
import { createAuthRoutes } from './routes/auth.js';
import {
  createApiKeyMiddleware,
  requireScope,
  type ApiKeyMiddlewareDeps,
} from './middleware/api-key.js';
import { rateLimiter } from './rate-limiter.js';
import { getMetricsJson } from '../metrics/collector.js';
import { openapiDocument } from './openapi.js';
import type { Request, Response } from 'express';

/** Redoc docs page rendering the served OpenAPI document. */
const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sluby API Reference</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

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
    ApiKeyMiddlewareDeps {}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  // Auth routes run BEFORE the API-key middleware: they are the path by
  // which the browser obtains a session in the first place, and /auth/me
  // must be callable unauthenticated so the Studio can decide whether to
  // show the sign-in screen.
  router.use('/auth', createAuthRoutes());

  // The API spec and its docs page are public (no key required) so tools
  // and humans can discover the contract before authenticating.
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openapiDocument);
  });
  router.get('/docs', (_req: Request, res: Response) => {
    res.type('html').send(DOCS_HTML);
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

  // Metrics endpoint (JSON format)
  router.get('/metrics', requireScope('read'), async (_req: Request, res: Response) => {
    const metrics = await getMetricsJson();
    res.json(metrics);
  });

  return router;
}

import { Router } from 'express';
import { createUploadRoutes, type UploadRouteDeps } from './routes/uploads.js';
import { createAssetRoutes, type AssetRouteDeps } from './routes/assets.js';
import { createSiaInfoRoutes, type SiaInfoRouteDeps } from './routes/sia-info.js';
import { createPlaybackRoutes, type PlaybackRouteDeps } from './routes/playback.js';
import { createPlaybackIdRoutes, type PlaybackIdRouteDeps } from './routes/playback-ids.js';
import { createReconciliationRoutes, type ReconciliationRouteDeps } from './routes/reconciliation.js';
import { createWebhookRoutes, type WebhookRouteDeps } from './routes/webhooks.js';
import { createAuthRoutes } from './routes/auth.js';
import { createApiKeyMiddleware, type ApiKeyMiddlewareDeps } from './middleware/api-key.js';
import { rateLimiter } from './rate-limiter.js';
import { generateApiKey } from './auth.js';
import { requireScope } from './middleware/api-key.js';
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

export interface ApiRouterDeps extends UploadRouteDeps, AssetRouteDeps, SiaInfoRouteDeps, PlaybackRouteDeps, PlaybackIdRouteDeps, ReconciliationRouteDeps, WebhookRouteDeps, ApiKeyMiddlewareDeps {
  createApiKey: (data: {
    keyHash: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    creatorAddress: string;
  }) => Promise<{ id: string }>;
  listApiKeys: (creatorAddress: string) => Promise<Array<{
    id: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    isActive: boolean;
    createdAt: Date;
  }>>;
  deleteApiKey: (id: string) => Promise<void>;
}

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

  // Apply middleware
  const apiKeyMiddleware = createApiKeyMiddleware(deps);
  router.use(rateLimiter());
  router.use(apiKeyMiddleware);

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

  // API key management routes
  router.post('/keys', requireScope('manage'), async (req: Request, res: Response) => {
    const { name, scopes, rate_limit } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const validScopes = ['upload', 'read', 'manage'];
    const requestedScopes = scopes ?? ['upload', 'read'];
    const invalidScopes = requestedScopes.filter((s: string) => !validScopes.includes(s));
    if (invalidScopes.length > 0) {
      res.status(400).json({ error: `Invalid scopes: ${invalidScopes.join(', ')}` });
      return;
    }

    const { key, hash } = generateApiKey();

    const result = await deps.createApiKey({
      keyHash: hash,
      name,
      scopes: requestedScopes,
      rateLimit: rate_limit ?? 100,
      creatorAddress: req.apiKey!.creatorAddress,
    });

    res.status(201).json({
      id: result.id,
      key, // Only shown once
      name,
      scopes: requestedScopes,
    });
  });

  router.get('/keys', requireScope('manage'), async (req: Request, res: Response) => {
    const keys = await deps.listApiKeys(req.apiKey!.creatorAddress);

    res.json({
      data: keys.map((k) => ({
        id: k.id,
        name: k.name,
        scopes: k.scopes,
        rate_limit: k.rateLimit,
        is_active: k.isActive,
        created_at: k.createdAt.toISOString(),
      })),
    });
  });

  router.delete('/keys/:id', requireScope('manage'), async (req: Request, res: Response) => {
    await deps.deleteApiKey(String(req.params.id));
    res.json({ success: true });
  });

  // Metrics endpoint (JSON format)
  router.get('/metrics', async (_req: Request, res: Response) => {
    const metrics = await getMetricsJson();
    res.json(metrics);
  });

  return router;
}

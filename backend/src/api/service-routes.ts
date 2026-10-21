import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { getMetrics, registry } from '../metrics/collector.js';
import { notFoundHandler } from './middleware/error-handler.js';

/**
 * GET /health. Liveness only: answers while the process is up. Dependency
 * health lives in GET /api/v1/system/status so a flaky indexer never
 * restarts the container.
 */
export function createHealthHandler(version: string): RequestHandler {
  return (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version,
    });
  };
}

/**
 * Whether a request reached the backend through a reverse proxy. The shipped
 * nginx sets X-Forwarded-For on every location it proxies, overwriting what
 * the client sent, and other proxies add it or the standard Forwarded header.
 * A scraper on the internal network talks to the backend port directly and
 * sends neither.
 */
function cameThroughProxy(req: Request): boolean {
  return req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined;
}

/**
 * Guard for GET /metrics. With a token configured the scraper must send it as
 * a bearer token, wherever it connects from. Without one the endpoint answers
 * only requests made straight to the backend port, which the shipped compose
 * files keep on the internal network; through a proxy it answers the same 404
 * as an unknown route, so an open endpoint is never reachable or advertised
 * from outside.
 */
export function requireMetricsToken(token: string | undefined): RequestHandler {
  if (!token) {
    return (req, res, next) => {
      if (cameThroughProxy(req)) {
        notFoundHandler(req, res);
        return;
      }
      next();
    };
  }
  const expected = createHash('sha256').update(token).digest();
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    // compare digests so the check takes the same time whatever was sent
    const actual = createHash('sha256').update(given).digest();
    if (given !== '' && timingSafeEqual(actual, expected)) {
      next();
      return;
    }
    res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'Metrics token required' });
  };
}

/** GET /metrics in the Prometheus text format, for a scraper. */
export function createPrometheusHandler(log: Logger): RequestHandler {
  return async (_req: Request, res: Response) => {
    try {
      const metricsText = await getMetrics();
      res.set('Content-Type', registry.contentType);
      res.end(metricsText);
    } catch (err) {
      log.error({ err }, 'Failed to collect metrics');
      res.status(500).json({ error: 'Failed to collect metrics' });
    }
  };
}

import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { getMetrics, registry } from '../metrics/collector.js';

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

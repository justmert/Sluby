/**
 * Test helpers for Express route testing.
 * Creates a minimal Express app with error handling for route tests.
 */
import 'express-async-errors';
import express, { type Express, type Router, type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../../api/middleware/error-handler.js';

/**
 * Creates a test Express app with the given router and an error handler.
 * Uses express-async-errors to catch async route handler errors.
 */
export function createTestApp(router: Router, basePath = '/'): Express {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);

  // Error handler that mimics the real one
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message, details: err.details });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/**
 * Attach a mock apiKey to incoming requests (simulates authenticated request).
 */
export function withApiKey(
  app: Express,
  apiKey: {
    id: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    creatorAddress: string;
  },
): Express {
  const wrapped = express();
  wrapped.use(express.json());
  wrapped.use((req: Request, _res: Response, next: NextFunction) => {
    req.apiKey = apiKey;
    next();
  });
  wrapped.use(app);
  return wrapped;
}

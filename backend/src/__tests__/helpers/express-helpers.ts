/**
 * Test helpers for Express route testing.
 * Mounts a router behind the app's real 404 and error handlers, so route
 * tests see the same status codes and bodies the running server sends.
 */
import 'express-async-errors';
import express, {
  type Express,
  type Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import pino from 'pino';
import { createErrorHandler, notFoundHandler } from '../../api/middleware/error-handler.js';

// the real handler logs every error; keep test output readable
const silentLogger = pino({ level: 'silent' });

/**
 * Creates a test Express app with the given router, the app's 404 handler
 * and its error handler. express-async-errors forwards rejected async
 * handlers to it, as in the app.
 */
export function createTestApp(router: Router, basePath = '/'): Express {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  app.use(notFoundHandler);
  app.use(createErrorHandler(silentLogger));
  return app;
}

/**
 * Attach a mock apiKey to incoming requests (simulates authenticated request).
 * A caller is not an operator unless the key says so.
 */
export function withApiKey(
  app: Express,
  apiKey: {
    id: string;
    name: string;
    scopes: string[];
    rateLimit: number;
    creatorAddress: string;
    operator?: boolean;
  },
): Express {
  const wrapped = express();
  wrapped.use(express.json());
  wrapped.use((req: Request, _res: Response, next: NextFunction) => {
    req.apiKey = { operator: false, ...apiKey };
    next();
  });
  wrapped.use(app);
  return wrapped;
}

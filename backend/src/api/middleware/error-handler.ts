import type { ErrorRequestHandler, Request, Response } from 'express';
import type { Logger } from 'pino';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** JSON 404 for any route nothing else answered. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

/**
 * The app's last middleware. Any error carrying a `statusCode` (AppError, or
 * an Error with the property assigned) answers with that status; an error
 * without one is a 500. The client sees the message for 4xx and for any
 * AppError, and a generic text otherwise. Outside production the body also
 * carries the message and stack for debugging.
 */
export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (err: Error, req, res, _next) => {
    // A malformed path param that reaches a `uuid`/typed column makes Postgres
    // raise SQLSTATE 22P02 (invalid_text_representation). That is a bad
    // request, not a server fault, so map it to 400 with a clean message
    // instead of leaking a 500 and the driver error. Applies uniformly to
    // every id route.
    const pgCode = (err as unknown as { code?: string }).code;
    if (pgCode === '22P02') {
      res.status(400).json({ error: 'Invalid identifier format' });
      return;
    }

    const statusCode = (err as unknown as { statusCode?: number }).statusCode ?? 500;
    const isProduction = process.env.NODE_ENV === 'production';

    log.error(
      {
        err,
        method: req.method,
        url: req.url,
        statusCode,
      },
      'Unhandled error',
    );

    // an AppError's message is written for the client, even for a 5xx such as
    // a 502 from an upstream; only unexpected errors get the generic text
    const exposeMessage = statusCode < 500 || err instanceof AppError;
    res.status(statusCode).json({
      error: exposeMessage ? err.message : 'Internal Server Error',
      ...(isProduction ? {} : { message: err.message, stack: err.stack }),
    });
  };
}

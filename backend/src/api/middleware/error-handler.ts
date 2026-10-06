import type { ErrorRequestHandler, Request, Response } from 'express';
import type { Logger } from 'pino';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /** Sent to the client as `details`, e.g. the list of invalid fields. */
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** JSON 404 for any route nothing else answered, in the shape of every other error. */
export function notFoundHandler(req: Request, res: Response): void {
  const path = req.originalUrl.split('?')[0];
  res.status(404).json({ error: `Route ${req.method} ${path} not found` });
}

/**
 * Postgres errors that only a bad request can cause. Validation stops these
 * before the query in the normal case; this mapping keeps a missed case a 400
 * instead of a 500. 22P02 comes from a malformed id reaching a uuid column.
 */
const CLIENT_SQLSTATES: Record<string, string> = {
  '22P02': 'Invalid identifier format',
  '23502': 'A required value is missing',
  '22001': 'A value is too long',
  '22003': 'A number is out of range',
  '22021': 'A text value contains a byte sequence that is not valid text',
};

/**
 * The app's last middleware. Any error carrying a `statusCode` (AppError, or
 * an Error with the property assigned, such as body-parser's) answers with
 * that status; an error without one is a 500. The client sees the message for
 * 4xx and for any AppError, and a generic text otherwise. Outside production
 * the body also carries the message and stack for debugging.
 */
export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (err: Error, req, res, next) => {
    // a response that already started (a stream that failed midway) cannot
    // get a JSON error body; express closes the connection instead
    if (res.headersSent) {
      next(err);
      return;
    }

    const sqlstate = postgresCode(err);
    const clientMessage = sqlstate ? CLIENT_SQLSTATES[sqlstate] : undefined;
    if (clientMessage) {
      log.warn({ method: req.method, url: req.url, sqlstate }, 'Request rejected by the database');
      res.status(400).json({ error: clientMessage });
      return;
    }

    const statusCode = (err as unknown as { statusCode?: number }).statusCode ?? 500;
    const isProduction = process.env.NODE_ENV === 'production';

    const context = { err, method: req.method, url: req.url, statusCode };
    if (statusCode >= 500) log.error(context, 'Request failed');
    else log.warn(context, 'Request rejected');

    // an AppError's message is written for the client, even for a 5xx such as
    // a 502 from an upstream; only unexpected errors get the generic text
    const exposeMessage = statusCode < 500 || err instanceof AppError;
    const details = err instanceof AppError ? err.details : undefined;
    res.status(statusCode).json({
      error: exposeMessage ? err.message : 'Internal Server Error',
      ...(details !== undefined ? { details } : {}),
      ...(isProduction ? {} : { message: err.message, stack: err.stack }),
    });
  };
}

/**
 * The SQLSTATE of a Postgres error. drizzle wraps driver errors in a
 * DrizzleQueryError whose `cause` is the original, so look there too.
 */
export function postgresCode(err: unknown): string | undefined {
  const own = (err as { code?: unknown } | null)?.code;
  if (typeof own === 'string') return own;
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === 'string' ? cause : undefined;
}

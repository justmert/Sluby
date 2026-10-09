import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cors, { type CorsOptions } from 'cors';

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Tus-Resumable',
  'Upload-Length',
  'Upload-Offset',
  'Upload-Metadata',
  'Upload-Concat',
  'Upload-Defer-Length',
  'X-Requested-With',
  'If-Match',
];

const EXPOSED_HEADERS = [
  'Upload-Offset',
  'Upload-Length',
  'Upload-Metadata',
  'Tus-Version',
  'Tus-Resumable',
  'Tus-Max-Size',
  'Tus-Extension',
  'Location',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'ETag',
];

const BASE: CorsOptions = {
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ALLOWED_HEADERS,
  exposedHeaders: EXPOSED_HEADERS,
  maxAge: 600,
};

export interface ApiCorsPolicy {
  /** Origins trusted with the session cookie (CORS_ORIGIN). */
  credentialedOrigins: readonly string[];
  /** AUTH_DISABLED: every request is the dev user, so a cookie is not even
   *  needed to act as them. */
  authDisabled: boolean;
}

export type CorsDecision = 'credentialed' | 'anonymous' | 'none';

/**
 * What a cross-origin caller may do. Listed origins get credentialed CORS.
 * Any other origin gets CORS without credentials, which is all a bearer-key
 * caller needs and never lets a cookie ride along, except while auth is
 * disabled: then a response readable by any page would hand that page the
 * dev user, so unlisted origins get nothing.
 */
export function corsDecision(origin: string | undefined, policy: ApiCorsPolicy): CorsDecision {
  if (!origin) return 'none';
  if (policy.credentialedOrigins.includes(origin)) return 'credentialed';
  return policy.authDisabled ? 'none' : 'anonymous';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse writes a page on another origin could send without a preflight. CORS
 * only decides who may read a response: a form-encoded POST from any page
 * still reaches the routes, and it carries the session cookie from same-site
 * origins, while AUTH_DISABLED needs no cookie at all. Such a request has an
 * Origin that is not this server's and no Authorization header (a header a
 * cross-origin page can only send after a preflight), so it can only ever be
 * acting on ambient credentials.
 */
export function createCrossOriginWriteGuard(
  policy: ApiCorsPolicy,
  publicUrl: string,
): RequestHandler {
  const publicOrigin = new URL(publicUrl).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (
      SAFE_METHODS.has(req.method) ||
      !origin ||
      req.headers.authorization ||
      origin === publicOrigin ||
      origin === `${req.protocol}://${req.headers.host}` ||
      policy.credentialedOrigins.includes(origin)
    ) {
      next();
      return;
    }
    res.status(403).json({ error: 'Cross-origin request refused' });
  };
}

/** CORS for /api. The delivery routes answer their own, credential-free. */
export function createApiCors(policy: ApiCorsPolicy): RequestHandler {
  const middleware = cors((req, callback) => {
    const decision = corsDecision(req.headers.origin, policy);
    if (decision === 'credentialed') {
      callback(null, { ...BASE, origin: req.headers.origin, credentials: true });
    } else if (decision === 'anonymous') {
      callback(null, { ...BASE, origin: '*', credentials: false });
    } else {
      callback(null, { origin: false });
    }
  });
  return (req: Request, res: Response, next: NextFunction) => {
    // the answer depends on the origin whenever some origins are treated
    // differently, so caches must key on it
    if (policy.credentialedOrigins.length > 0 || policy.authDisabled) res.vary('Origin');
    middleware(req, res, next);
  };
}

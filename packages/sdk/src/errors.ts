// ---------------------------------------------------------------------------
// @siastream/sdk - Custom error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all SiaStream SDK errors.
 *
 * Carries an HTTP status code when the error originates from an API response
 * and preserves the original response body for debugging.
 */
export class SiaStreamError extends Error {
  /** HTTP status code returned by the API, or `0` for client-side errors. */
  readonly statusCode: number;

  /** Raw response body (when available). */
  readonly responseBody?: string;

  constructor(message: string, statusCode: number = 0, responseBody?: string) {
    super(message);
    this.name = 'SiaStreamError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;

    // Maintain proper prototype chain for `instanceof` checks.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns a 401 Unauthorized or 403 Forbidden response.
 */
export class AuthenticationError extends SiaStreamError {
  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message, statusCode, responseBody);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the API returns a 404 Not Found response.
 */
export class NotFoundError extends SiaStreamError {
  constructor(message: string, responseBody?: string) {
    super(message, 404, responseBody);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when the API returns a 429 Too Many Requests response.
 */
export class RateLimitError extends SiaStreamError {
  /** Seconds until the client should retry (from Retry-After header). */
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, responseBody?: string) {
    super(message, 429, responseBody);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when an operation exceeds its timeout.
 */
export class TimeoutError extends SiaStreamError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'TimeoutError';
  }
}

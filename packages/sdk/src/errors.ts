// ---------------------------------------------------------------------------
// @sluby/sdk - Custom error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all Sluby SDK errors.
 *
 * Carries an HTTP status code when the error originates from an API response
 * and preserves the original response body for debugging.
 */
export class SlubyError extends Error {
  /** HTTP status code returned by the API, or `0` for client-side errors. */
  readonly statusCode: number;

  /** Raw response body (when available). */
  readonly responseBody?: string;

  constructor(message: string, statusCode: number = 0, responseBody?: string) {
    super(message);
    this.name = 'SlubyError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;

    // Maintain proper prototype chain for `instanceof` checks.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns a 401 Unauthorized or 403 Forbidden response.
 */
export class AuthenticationError extends SlubyError {
  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message, statusCode, responseBody);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the API returns a 404 Not Found response.
 */
export class NotFoundError extends SlubyError {
  constructor(message: string, responseBody?: string) {
    super(message, 404, responseBody);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when the API returns a 429 Too Many Requests response.
 */
export class RateLimitError extends SlubyError {
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
export class TimeoutError extends SlubyError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'TimeoutError';
  }
}

/**
 * The typed error for a failed response (401/403, 404, 429, anything else).
 * Reads the body, so call it only once the response is known to be an error.
 */
export async function errorFromResponse(response: Response): Promise<SlubyError> {
  let responseBody: string | undefined;
  try {
    responseBody = await response.text();
  } catch {
    // Reading the body may fail; that is acceptable.
  }

  const message = extractErrorMessage(responseBody, response.statusText);

  switch (response.status) {
    case 401:
    case 403:
      return new AuthenticationError(message, response.status, responseBody);
    case 404:
      return new NotFoundError(message, responseBody);
    case 429:
      return new RateLimitError(
        message,
        parseRetryAfter(response.headers.get('Retry-After')),
        responseBody,
      );
    default:
      return new SlubyError(message, response.status, responseBody);
  }
}

/**
 * Seconds to wait from a Retry-After header. RFC 9110 allows either a number
 * of seconds or an HTTP date, and a plain Number() turns the date form into NaN.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Attempt to extract a human-readable error message from the response body
 * (expecting `{ "error": "..." }` or `{ "message": "..." }`), falling back
 * to the status text.
 */
function extractErrorMessage(responseBody: string | undefined, statusText: string): string {
  if (responseBody) {
    try {
      const json = JSON.parse(responseBody);
      if (typeof json.error === 'string') return json.error;
      if (typeof json.message === 'string') return json.message;
    } catch {
      // Not JSON -- use the raw text if short enough.
      if (responseBody.length < 200) return responseBody;
    }
  }
  return statusText || 'Unknown API error';
}

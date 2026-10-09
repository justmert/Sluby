import type { VideoAsset } from './types.js';

/**
 * Base error class for all Sluby SDK errors.
 *
 * Carries an HTTP status code when the error originates from an API response
 * and preserves the original response body for debugging. `cause` holds the
 * underlying error (a network failure, a tus error) when there is one.
 */
export class SlubyError extends Error {
  /** HTTP status code returned by the API, or `0` for client-side errors. */
  readonly statusCode: number;

  /** Raw response body (when available). */
  readonly responseBody?: string;

  constructor(
    message: string,
    statusCode: number = 0,
    responseBody?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SlubyError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;

    // Maintain proper prototype chain for `instanceof` checks.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns 401 Unauthorized: the key or session is
 * missing, wrong, revoked or expired.
 */
export class AuthenticationError extends SlubyError {
  constructor(message: string, statusCode: number = 401, responseBody?: string) {
    super(message, statusCode, responseBody);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the API returns 403 Forbidden: the caller is known but not
 * allowed to do this (a key without the needed scope, or a signed URL that is
 * invalid or expired).
 */
export class PermissionError extends SlubyError {
  constructor(message: string, responseBody?: string) {
    super(message, 403, responseBody);
    this.name = 'PermissionError';
  }
}

/**
 * Thrown when the API returns 404 Not Found, or 410 Gone for something that
 * existed and no longer does (such as a source file that was already removed).
 */
export class NotFoundError extends SlubyError {
  constructor(message: string, responseBody?: string, statusCode: 404 | 410 = 404) {
    super(message, statusCode, responseBody);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when the API returns 409 Conflict: the resource is not in a state
 * that allows the request, such as playback of an asset that is still
 * processing or cancelling an upload that already finished. Also thrown for
 * 412 Precondition Failed: an `assets.update` with `ifMatch` found the asset
 * changed since that version; `current` is then the asset as it is now.
 */
export class ConflictError extends SlubyError {
  /** With a 412 from `assets.update`, the asset as the server has it now. */
  readonly current?: VideoAsset;

  constructor(
    message: string,
    responseBody?: string,
    statusCode: 409 | 412 = 409,
    current?: VideoAsset,
  ) {
    super(message, statusCode, responseBody);
    this.name = 'ConflictError';
    this.current = current;
  }
}

/**
 * Thrown when the API rejects the request as malformed (400 Bad Request or
 * 422 Unprocessable Content), such as an unknown filter value.
 */
export class ValidationError extends SlubyError {
  constructor(message: string, statusCode: 400 | 422 = 400, responseBody?: string) {
    super(message, statusCode, responseBody);
    this.name = 'ValidationError';
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
 * Thrown when an operation exceeds its timeout: `SlubyConfig.timeoutMs` for a
 * request, or the `timeout` of `assets.waitForReady`.
 */
export class TimeoutError extends SlubyError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'TimeoutError';
  }
}

/**
 * Thrown when the caller cancelled the operation: an `AbortSignal` passed to a
 * method fired, or `abort()` was called on an upload. Its `name` is
 * `'AbortError'`, the same as the DOM's, so code that checks the name for
 * cancelled fetches handles it too. `cause` is the signal's reason when a
 * signal fired.
 */
export class AbortError extends SlubyError {
  constructor(message: string = 'The operation was aborted', options?: { cause?: unknown }) {
    super(message, 0, undefined, options);
    this.name = 'AbortError';
  }
}

/**
 * Thrown by `assets.waitForReady` when the asset ends in `failed`. Carries the
 * asset as last read, so the caller can show it or call `assets.processing`
 * for the error and log.
 */
export class ProcessingFailedError extends SlubyError {
  readonly asset: VideoAsset;

  constructor(asset: VideoAsset) {
    super(`Video asset ${asset.id} failed processing.`, 0);
    this.name = 'ProcessingFailedError';
    this.asset = asset;
  }
}

/**
 * The typed error for an HTTP status, with an already extracted message.
 * Shared by API responses and tus upload responses.
 */
export function errorFromStatus(
  status: number,
  message: string,
  responseBody?: string,
  retryAfter?: string | null,
): SlubyError {
  switch (status) {
    case 400:
    case 422:
      return new ValidationError(message, status, responseBody);
    case 401:
      return new AuthenticationError(message, 401, responseBody);
    case 403:
      return new PermissionError(message, responseBody);
    case 404:
    case 410:
      return new NotFoundError(message, responseBody, status);
    case 409:
    case 412:
      return new ConflictError(message, responseBody, status);
    case 429:
      return new RateLimitError(message, parseRetryAfter(retryAfter ?? null), responseBody);
    default:
      return new SlubyError(message, status, responseBody);
  }
}

/**
 * The typed error for a failed response. Reads the body, so call it only once
 * the response is known to be an error.
 */
export async function errorFromResponse(response: Response): Promise<SlubyError> {
  let responseBody: string | undefined;
  try {
    responseBody = await response.text();
  } catch {
    // the body may be unreadable (connection dropped); the status still says enough
  }
  return errorFromStatus(
    response.status,
    extractErrorMessage(responseBody, response.statusText),
    responseBody,
    response.headers.get('Retry-After'),
  );
}

/**
 * Parse a successful response's JSON body. A 2xx with a body that is not JSON
 * (a proxy's HTML page, a truncated body) becomes a `SlubyError` carrying the
 * text instead of a bare `SyntaxError`.
 */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new SlubyError(
      `Expected a JSON response from ${response.url || 'the API'} but could not parse it.`,
      response.status,
      text,
      { cause: err },
    );
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
 * Extract a human-readable error message from a response body (expecting
 * `{ "error": "..." }` or `{ "message": "..." }`), falling back to the status
 * text. A body that is not JSON is used only when it reads as one short line:
 * a proxy's HTML error page (`<html><body><h1>502 Bad Gateway</h1>...`) is
 * markup, not a message, so it falls back to the status text instead.
 */
export function extractErrorMessage(responseBody: string | undefined, statusText: string): string {
  if (responseBody) {
    try {
      const json = JSON.parse(responseBody);
      if (typeof json.error === 'string') return json.error;
      if (typeof json.message === 'string') return json.message;
    } catch {
      const text = responseBody.trim();
      if (text !== '' && text.length < 200 && !text.startsWith('<') && !/[\r\n]/.test(text)) {
        return text;
      }
    }
  }
  return statusText || 'Unknown API error';
}

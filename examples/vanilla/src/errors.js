import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SlubyError,
  ValidationError,
} from '@sluby/sdk';

/**
 * Turn anything the SDK throws into a message a person can act on.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  if (err instanceof AuthenticationError) {
    return `The API key was rejected: ${err.message}`;
  }
  if (err instanceof PermissionError) {
    return `This API key lacks the scope for that call: ${err.message}`;
  }
  if (err instanceof NotFoundError) {
    return `Not found: ${err.message}`;
  }
  if (err instanceof ValidationError) {
    return `The request was refused: ${err.message}`;
  }
  if (err instanceof ConflictError) {
    // for example playing an asset that is not ready yet
    return `Not possible right now: ${err.message}`;
  }
  if (err instanceof RateLimitError) {
    return `Rate limited, retry in ${err.retryAfter ?? '?'} seconds.`;
  }
  if (err instanceof SlubyError) {
    // timeouts, aborts and failed processing carry statusCode 0
    return err.statusCode ? `API error ${err.statusCode}: ${err.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

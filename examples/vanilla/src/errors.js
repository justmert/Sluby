import { AuthenticationError, NotFoundError, RateLimitError, SlubyError } from '@sluby/sdk';

/**
 * Turn anything the SDK throws into a message a person can act on.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  if (err instanceof AuthenticationError) {
    // 401 is a missing or bad key, 403 a key without the scope this call needs
    return err.statusCode === 403
      ? `This API key lacks the scope for that call: ${err.message}`
      : `The API key was rejected: ${err.message}`;
  }
  if (err instanceof NotFoundError) {
    return `Not found: ${err.message}`;
  }
  if (err instanceof RateLimitError) {
    return `Rate limited, retry in ${err.retryAfter ?? '?'} seconds.`;
  }
  if (err instanceof SlubyError) {
    // TimeoutError lands here too, with statusCode 0
    return err.statusCode ? `API error ${err.statusCode}: ${err.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

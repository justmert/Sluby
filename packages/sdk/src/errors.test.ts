import { describe, it, expect } from 'vitest';
import {
  SiaStreamError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
} from './errors.js';

describe('SiaStreamError', () => {
  it('should create an instance with message and default statusCode', () => {
    const error = new SiaStreamError('something went wrong');
    expect(error.message).toBe('something went wrong');
    expect(error.statusCode).toBe(0);
    expect(error.responseBody).toBeUndefined();
    expect(error.name).toBe('SiaStreamError');
  });

  it('should accept statusCode and responseBody', () => {
    const error = new SiaStreamError('server error', 500, '{"error":"bad"}');
    expect(error.statusCode).toBe(500);
    expect(error.responseBody).toBe('{"error":"bad"}');
  });

  it('should be an instance of Error', () => {
    const error = new SiaStreamError('test');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SiaStreamError);
  });
});

describe('AuthenticationError', () => {
  it('should set name and statusCode', () => {
    const error = new AuthenticationError('unauthorized', 401, '{}');
    expect(error.name).toBe('AuthenticationError');
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('unauthorized');
    expect(error.responseBody).toBe('{}');
  });

  it('should be instanceof SiaStreamError and Error', () => {
    const error = new AuthenticationError('forbidden', 403);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toBeInstanceOf(SiaStreamError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should work with 403 status code', () => {
    const error = new AuthenticationError('forbidden', 403);
    expect(error.statusCode).toBe(403);
  });
});

describe('NotFoundError', () => {
  it('should set name and statusCode to 404', () => {
    const error = new NotFoundError('not found');
    expect(error.name).toBe('NotFoundError');
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('not found');
  });

  it('should accept responseBody', () => {
    const error = new NotFoundError('not found', '{"detail":"no such asset"}');
    expect(error.responseBody).toBe('{"detail":"no such asset"}');
  });

  it('should be instanceof SiaStreamError and Error', () => {
    const error = new NotFoundError('nope');
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toBeInstanceOf(SiaStreamError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('RateLimitError', () => {
  it('should set name and statusCode to 429', () => {
    const error = new RateLimitError('too many requests');
    expect(error.name).toBe('RateLimitError');
    expect(error.statusCode).toBe(429);
    expect(error.message).toBe('too many requests');
  });

  it('should store retryAfter', () => {
    const error = new RateLimitError('slow down', 30);
    expect(error.retryAfter).toBe(30);
  });

  it('should accept responseBody', () => {
    const error = new RateLimitError('slow down', 60, '{"retry_after":60}');
    expect(error.responseBody).toBe('{"retry_after":60}');
  });

  it('should have undefined retryAfter when not provided', () => {
    const error = new RateLimitError('slow down');
    expect(error.retryAfter).toBeUndefined();
  });

  it('should be instanceof SiaStreamError and Error', () => {
    const error = new RateLimitError('too many requests');
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(SiaStreamError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('TimeoutError', () => {
  it('should set name and statusCode to 0', () => {
    const error = new TimeoutError('operation timed out');
    expect(error.name).toBe('TimeoutError');
    expect(error.statusCode).toBe(0);
    expect(error.message).toBe('operation timed out');
  });

  it('should be instanceof SiaStreamError and Error', () => {
    const error = new TimeoutError('timeout');
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(SiaStreamError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should not have responseBody', () => {
    const error = new TimeoutError('timeout');
    expect(error.responseBody).toBeUndefined();
  });
});

describe('Error class hierarchy', () => {
  it('should distinguish between error types with instanceof', () => {
    const authErr = new AuthenticationError('auth', 401);
    const notFoundErr = new NotFoundError('nf');
    const rateLimitErr = new RateLimitError('rl');
    const timeoutErr = new TimeoutError('to');

    // Each is its own type but not the others
    expect(authErr).toBeInstanceOf(AuthenticationError);
    expect(authErr).not.toBeInstanceOf(NotFoundError);
    expect(authErr).not.toBeInstanceOf(RateLimitError);
    expect(authErr).not.toBeInstanceOf(TimeoutError);

    expect(notFoundErr).toBeInstanceOf(NotFoundError);
    expect(notFoundErr).not.toBeInstanceOf(AuthenticationError);

    expect(rateLimitErr).toBeInstanceOf(RateLimitError);
    expect(rateLimitErr).not.toBeInstanceOf(NotFoundError);

    expect(timeoutErr).toBeInstanceOf(TimeoutError);
    expect(timeoutErr).not.toBeInstanceOf(RateLimitError);

    // All are SiaStreamError
    expect(authErr).toBeInstanceOf(SiaStreamError);
    expect(notFoundErr).toBeInstanceOf(SiaStreamError);
    expect(rateLimitErr).toBeInstanceOf(SiaStreamError);
    expect(timeoutErr).toBeInstanceOf(SiaStreamError);
  });
});

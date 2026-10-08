import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  SlubyError,
  TimeoutError,
  ValidationError,
} from '@sluby/sdk';
import { ApiError, RequestTimeoutError } from './api-client';
import { describeError, errorText, fieldErrorsOf, isRetryable, withLead } from './errors';

// what the ui must never show as the headline
const RAW = /Internal Server Error|HTTP \d{3}|Failed to fetch|<html|Bad Gateway|Unknown API error/i;

describe('errorText', () => {
  it.each([
    ['a 500 from the api', new ApiError(500, 'Internal Server Error')],
    ['a 502 the api client got as html', new ApiError(502, 'HTTP 502')],
    ['a 503 from the sdk', new SlubyError('Service Unavailable', 503)],
    ['a proxy page through the sdk', new SlubyError('<html><body><h1>502 Bad Gateway</h1>', 502)],
  ])('turns %s into the server problem sentence', (_name, err) => {
    const text = errorText(err);
    expect(text).toMatch(
      /^The server ran into a problem \(error 5\d\d\)\. Try again in a moment\./,
    );
    expect(text).not.toMatch(RAW);
  });

  it('says the server could not be reached when there was no response', () => {
    expect(errorText(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('says the server was too slow on a timeout, from either client', () => {
    expect(errorText(new RequestTimeoutError(20_000))).toMatch(/took too long/);
    expect(errorText(new TimeoutError('Request timed out'))).toMatch(/took too long/);
  });

  it('asks to wait as long as a 429 said', () => {
    expect(errorText(new ApiError(429, 'Rate limit exceeded', undefined, 12))).toBe(
      'Too many requests. Wait 12 seconds and try again.',
    );
    expect(errorText(new RateLimitError('Too many requests'))).toBe(
      'Too many requests. Wait a few seconds and try again.',
    );
    expect(describeError(new RateLimitError('x', 3))).toMatchObject({
      kind: 'rate-limited',
      action: 'wait',
      retryAfter: 3,
    });
  });

  it('rewrites the backend messages from the error map', () => {
    expect(errorText(new NotFoundError('Video asset not found'))).toBe(
      'This video no longer exists. It may have been deleted.',
    );
    expect(
      errorText(new ConflictError('This account already has 20 API keys; delete one first')),
    ).toBe(
      'This account already has 20 API keys, the most allowed. Revoke one you no longer use, then try again.',
    );
    expect(errorText(new ApiError(410, 'Source file not found, please re-upload the video'))).toBe(
      'Could not retry because the original file is gone. Upload the video again.',
    );
    expect(errorText(new ApiError(400, 'Asset is not in failed state'))).toMatch(
      /^Only a failed video can be retried/,
    );
    expect(
      errorText(
        new SlubyError('The Sia indexer did not answer while minting share URLs; try again', 502),
      ),
    ).toBe('Could not start playback from Sia. Try again in a moment.');
    expect(
      errorText(new ApiError(400, 'URL refused: localhost resolves to loopback (::1)')),
    ).toMatch(/WEBHOOK_ALLOWED_NETWORKS/);
  });

  it('treats a malformed id like a missing one', () => {
    expect(describeError(new ValidationError('Invalid identifier format'))).toMatchObject({
      kind: 'not-found',
      message: 'Check the link. It may have been deleted, or it belongs to another account.',
    });
  });

  it('falls back to a plain sentence for unknown 403, 404 and 409', () => {
    expect(errorText(new ApiError(403, 'nope'))).toMatch(/do not have access/);
    expect(errorText(new ApiError(404, 'Route GET /x not found'))).toBe(
      'It no longer exists. It may have been deleted.',
    );
    expect(errorText(new ApiError(409, 'HTTP 409'))).toBe(
      'This changed in the meantime. Refresh and try again.',
    );
  });

  it('keeps a readable validation message as a sentence', () => {
    expect(
      errorText(new ApiError(400, 'title: String must contain at most 200 character(s)')),
    ).toBe('Title: String must contain at most 200 character(s).');
    expect(errorText(new ApiError(400, '<html>bad</html>'))).toBe(
      'Some details are not valid. Check them and try again.',
    );
  });

  it('keeps the raw message as detail, never as the text', () => {
    const info = describeError(new ApiError(500, 'Internal Server Error'));
    expect(info.detail).toBe('Internal Server Error');
    expect(info.message).not.toMatch(RAW);
  });

  it('does not invent a message for an unknown thrown value', () => {
    expect(errorText('kaput')).toBe('Something went wrong. Try again in a moment.');
    expect(errorText(undefined)).toBe('Something went wrong. Try again in a moment.');
  });
});

describe('withLead', () => {
  it('joins a lead and the error as sentences, without a colon', () => {
    expect(withLead('Could not delete the video', new ApiError(500, 'Internal Server Error'))).toBe(
      'Could not delete the video. The server ran into a problem (error 500). Try again in a moment. If it keeps happening, check the server logs.',
    );
    expect(withLead('Could not save:', new TypeError('Failed to fetch'))).toMatch(
      /^Could not save\. Could not reach the server\./,
    );
  });
});

describe('isRetryable', () => {
  it('is true for transient failures and false for answers that will not change', () => {
    expect(isRetryable(new ApiError(503, 'x'))).toBe(true);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new ApiError(429, 'x'))).toBe(true);
    expect(isRetryable(new ApiError(404, 'x'))).toBe(false);
    expect(isRetryable(new ApiError(403, 'x'))).toBe(false);
  });
});

describe('fieldErrorsOf', () => {
  it('maps backend validation details to fields', () => {
    const err = new ApiError(400, 'rate_limit must be at most 10000', [
      { field: 'rate_limit', message: 'rate_limit must be at most 10000' },
      { field: 'name', message: 'required' },
    ]);
    expect(fieldErrorsOf(err)).toEqual({
      rate_limit: 'Enter a number from 1 to 10,000.',
      name: 'Required.',
    });
    expect(fieldErrorsOf(new ApiError(400, 'x'))).toEqual({});
    expect(fieldErrorsOf(new Error('x'))).toEqual({});
  });
});

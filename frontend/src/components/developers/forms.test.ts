import { describe, expect, it } from 'vitest';
import { emptyKeyForm, keyFormErrors, urlProblem } from './forms';
import { keyLabel } from './key-label';

describe('key form checks (CPY-28, FLW-49)', () => {
  it('accepts the defaults with a name', () => {
    expect(keyFormErrors({ ...emptyKeyForm(), name: 'CI' })).toEqual({
      name: null,
      scopes: null,
      rateLimit: null,
    });
  });

  it('says what to fix in one short sentence each', () => {
    const errors = keyFormErrors({ name: ' ', scopes: [], rateLimit: '1.5' });
    expect(errors).toEqual({
      name: 'Enter a name.',
      scopes: 'Choose at least one scope.',
      rateLimit: 'Enter a whole number, 1 or more.',
    });
    for (const e of Object.values(errors)) expect(e!.length).toBeLessThanOrEqual(60);
  });

  it('holds the rate to the server limit when it is known', () => {
    expect(
      keyFormErrors({ ...emptyKeyForm(), name: 'a', rateLimit: '20000' }, 10_000).rateLimit,
    ).toBe('Use at most 10,000 requests per minute.');
    expect(
      keyFormErrors({ ...emptyKeyForm(), name: 'a', rateLimit: '20000' }).rateLimit,
    ).toBeNull();
  });
});

describe('webhook url check', () => {
  it.each([
    ['', 'Enter the URL that should get the events.'],
    ['example.com/hook', 'Enter a full URL, such as https://example.com/sluby-hook.'],
    ['ftp://example.com/hook', 'The URL must start with https:// or http://.'],
    [`https://example.com/${'a'.repeat(2048)}`, 'Use a URL of at most 2,048 characters.'],
    ['https://example.com/hook', null],
  ])('%s', (url, problem) => {
    expect(urlProblem(url)).toBe(problem);
  });
});

describe('keyLabel (FLW-28)', () => {
  it('tells a rotated pair apart by prefix, or by ID for old keys', () => {
    expect(keyLabel({ id: 'abcdef1234', name: 'CI', prefix: 'sluby_AbC123' })).toBe(
      '“CI” (sluby_AbC123…)',
    );
    expect(keyLabel({ id: 'abcdef1234', name: 'CI', prefix: null })).toBe('“CI” (ID abcdef12)');
  });
});

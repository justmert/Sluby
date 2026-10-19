import { describe, it, expect } from 'vitest';
import { sameSetupCode, setupCode } from '../api/auth/setup-code.js';

describe('setupCode', () => {
  it('is the first 50 bits of the hmac in crockford base32', () => {
    // reference values computed independently with python's hmac module
    expect(setupCode('test-secret')).toBe('BST04-X9QXV');
    expect(setupCode('another-secret')).toBe('EGYKH-W143W');
  });

  it('is stable per secret and differs across secrets', () => {
    expect(setupCode('test-secret')).toBe(setupCode('test-secret'));
    expect(setupCode('test-secret')).not.toBe(setupCode('test-secret2'));
  });

  it('uses only the crockford alphabet', () => {
    for (let i = 0; i < 50; i++) {
      expect(setupCode(`secret-${i}`)).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });
});

describe('sameSetupCode', () => {
  const secret = 'test-secret';

  it('accepts the code as shown', () => {
    expect(sameSetupCode('BST04-X9QXV', secret)).toBe(true);
  });

  it('ignores case, spaces and dashes', () => {
    expect(sameSetupCode('bst04x9qxv', secret)).toBe(true);
    expect(sameSetupCode(' bst04 - x9qxv ', secret)).toBe(true);
    expect(sameSetupCode('B-S-T-0-4-X-9-Q-X-V', secret)).toBe(true);
  });

  it('reads O as 0 and I or L as 1', () => {
    expect(sameSetupCode('BSTO4-X9QXV', secret)).toBe(true);
    expect(sameSetupCode('EGYKH-WI43W', 'another-secret')).toBe(true);
    expect(sameSetupCode('egykh-wl43w', 'another-secret')).toBe(true);
  });

  it('refuses a different code or secret', () => {
    expect(sameSetupCode('BST04-X9QXW', secret)).toBe(false);
    expect(sameSetupCode('BST04-X9QXV', 'another-secret')).toBe(false);
  });

  it('refuses the wrong length', () => {
    expect(sameSetupCode('', secret)).toBe(false);
    expect(sameSetupCode('BST04-X9QX', secret)).toBe(false);
    expect(sameSetupCode('BST04-X9QXVV', secret)).toBe(false);
  });
});

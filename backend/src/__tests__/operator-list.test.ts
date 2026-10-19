import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { parseOperatorUsers } from '../api/auth/operator-list.js';
import { envSchema } from '../config/env.js';

describe('OPERATOR_USERS syntax', () => {
  it('groups provider-qualified entries in each provider’s allowlist syntax', () => {
    expect(parseOperatorUsers(' github:id:583231 , GitHub:OctoCat,github:*,, gitlab:x ')).toEqual(
      new Map([
        ['github', ['id:583231', 'OctoCat', '*']],
        ['gitlab', ['x']],
      ]),
    );
    expect(parseOperatorUsers('')).toEqual(new Map());
  });

  it('refuses entries without a provider instead of guessing one', () => {
    for (const raw of ['octocat', 'id:583231', '*', ':octocat', 'github:', 'github:id:']) {
      expect(() => parseOperatorUsers(raw), raw).toThrow();
    }
  });

  it('fails env validation on a malformed entry and accepts an empty one', () => {
    const bad = envSchema.safeParse({ OPERATOR_USERS: 'github:alice,octocat' });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues[0].path).toEqual(['OPERATOR_USERS']);
    expect(bad.error.issues[0].message).toContain('"octocat" names no sign-in provider');
    expect(envSchema.parse({}).OPERATOR_USERS).toBe('');
  });
});

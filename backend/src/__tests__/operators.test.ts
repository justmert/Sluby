import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { parseOperatorUsers } from '../api/auth/operator-list.js';
import { isOperatorAccount, unknownOperatorProviders } from '../api/auth/operators.js';
import { resolveKeyOwner, type Account } from '../api/auth/access.js';
import { signInWarnings } from '../api/auth/startup.js';
import { env, envSchema } from '../config/env.js';

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

describe('operator accounts', () => {
  const saved = { ...env };
  afterEach(() => Object.assign(env, saved));

  const user = '11111111-1111-4111-8111-111111111111';
  const account = (provider: string, subject: string, pinned: string[] = []): Account => ({
    id: user,
    displayName: 'x',
    identities: [{ id: 'i', provider, subject, username: 'whatever', pinnedEntries: pinned }],
  });

  it('matches an id entry on the stable subject only', () => {
    env.OPERATOR_USERS = 'github:id:7';
    expect(isOperatorAccount(account('github', '7'))).toBe(true);
    expect(isOperatorAccount(account('github', '8'))).toBe(false);
  });

  it('matches a login entry through the account’s pin, never through the login alone', () => {
    env.OPERATOR_USERS = 'github:OctoCat';
    expect(isOperatorAccount(account('github', '7', ['octocat']))).toBe(true);
    expect(isOperatorAccount(account('github', '7'))).toBe(false);
  });

  it('makes nobody an operator when empty, unlike the sign-in allowlist', () => {
    env.OPERATOR_USERS = '';
    expect(isOperatorAccount(account('github', '7', ['octocat']))).toBe(false);
  });

  it('makes every account of a provider an operator with <provider>:*', () => {
    env.OPERATOR_USERS = 'github:*';
    expect(isOperatorAccount(account('github', '8'))).toBe(true);
  });

  it('never matches the local dev account or an unknown provider', () => {
    env.OPERATOR_USERS = 'local:dev,local:id:dev,gitlab:id:7,github:*';
    expect(isOperatorAccount(account('local', 'dev'))).toBe(false);
    expect(isOperatorAccount(account('gitlab', '7'))).toBe(false);
  });

  it('carries the role to the account’s keys only while the account is also allowed in', async () => {
    env.OPERATOR_USERS = 'github:id:7';
    env.GITHUB_ALLOWED_USERS = 'id:7';
    const deps = {
      getAccount: async () => account('github', '7'),
      findLegacyClaim: async () => null,
      isAllowlistEntryPinned: async () => false,
    };
    expect(await resolveKeyOwner(`user:${user}`, deps)).toEqual({
      allowed: true,
      address: `user:${user}`,
      operator: true,
    });
    env.GITHUB_ALLOWED_USERS = 'id:8';
    expect(await resolveKeyOwner(`user:${user}`, deps)).toEqual({
      allowed: false,
      address: `user:${user}`,
      operator: false,
    });
  });

  it('warns at startup about providers the server does not have', () => {
    env.GITHUB_CLIENT_ID = undefined;
    env.OPERATOR_USERS = 'github:id:7,gitlab:octocat';
    expect(unknownOperatorProviders()).toEqual(['gitlab']);
    expect(signInWarnings({ authDisabled: false, publicUrl: 'https://video.example.com' })).toEqual(
      [expect.stringContaining('OPERATOR_USERS names the sign-in provider "gitlab"')],
    );
    env.OPERATOR_USERS = 'github:id:7';
    expect(signInWarnings({ authDisabled: false, publicUrl: 'https://video.example.com' })).toEqual(
      [],
    );
  });
});

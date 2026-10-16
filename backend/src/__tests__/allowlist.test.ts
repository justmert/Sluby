import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { Allowlist } from '../api/auth/allowlist.js';
import {
  isAccountAllowed,
  resolveKeyOwner,
  currentOwnerAddress,
  type Account,
} from '../api/auth/access.js';
import { signInWarnings } from '../api/auth/startup.js';
import { env } from '../config/env.js';

const lower = (s: string) => s.toLowerCase();
const pins = (entries: Record<string, string> = {}) => new Map(Object.entries(entries));

describe('Allowlist parsing', () => {
  it('is open when empty, and explicitly open with *', () => {
    expect(new Allowlist('', lower)).toMatchObject({ open: true, explicitlyOpen: false });
    expect(new Allowlist(' , ', lower)).toMatchObject({ open: true, explicitlyOpen: false });
    expect(new Allowlist('*', lower)).toMatchObject({ open: true, explicitlyOpen: true });
    expect(new Allowlist('alice, *', lower)).toMatchObject({ open: true, explicitlyOpen: true });
    expect(new Allowlist('alice', lower)).toMatchObject({ open: false, explicitlyOpen: false });
  });

  it('splits handles from id entries, trimming and lowercasing handles', () => {
    const list = new Allowlist(' Alice , id:42 ,ID: 7, bob', lower);
    expect([...list.handles]).toEqual(['alice', 'bob']);
    expect([...list.subjects]).toEqual(['42', '7']);
  });
});

describe('Allowlist at sign-in', () => {
  const list = new Allowlist('alice,id:42', lower);

  it('admits a listed handle not pinned yet and asks to pin it', () => {
    expect(list.atSignIn('1', 'Alice', pins())).toEqual({ allowed: true, pin: 'alice' });
  });

  it('admits the pinned account under the same handle, with nothing to pin', () => {
    expect(list.atSignIn('1', 'alice', pins({ alice: '1' }))).toEqual({
      allowed: true,
      pin: undefined,
    });
  });

  it('refuses another account claiming a pinned handle (a recycled login)', () => {
    expect(list.atSignIn('2', 'alice', pins({ alice: '1' }))).toEqual({ allowed: false });
  });

  it('admits the pinned account after a rename', () => {
    expect(list.atSignIn('1', 'alice-renamed', pins({ alice: '1' })).allowed).toBe(true);
  });

  it('admits an id entry whatever the handle', () => {
    expect(list.atSignIn('42', 'whoever', pins()).allowed).toBe(true);
  });

  it('refuses anyone else', () => {
    expect(list.atSignIn('3', 'mallory', pins()).allowed).toBe(false);
  });

  it('ignores a pin whose entry is no longer listed', () => {
    expect(list.atSignIn('5', 'carol', pins({ carol: '5' })).allowed).toBe(false);
  });

  it('admits everyone when open, still pinning a listed handle', () => {
    const open = new Allowlist('*,alice', lower);
    expect(open.atSignIn('9', 'zed', pins())).toEqual({ allowed: true, pin: undefined });
    expect(open.atSignIn('1', 'alice', pins())).toEqual({ allowed: true, pin: 'alice' });
  });
});

describe('Allowlist on later requests', () => {
  const list = new Allowlist('alice,id:42', lower);

  it('admits by pin or id only, never by a handle alone', () => {
    expect(list.allows('1', ['alice'])).toBe(true);
    expect(list.allows('42', [])).toBe(true);
    expect(list.allows('1', [])).toBe(false);
    expect(list.allows('1', ['carol'])).toBe(false);
  });

  it('admits an unclaimed legacy handle only while listed and unpinned', () => {
    expect(list.allowsUnclaimedHandle('alice', false)).toBe(true);
    expect(list.allowsUnclaimedHandle('alice', true)).toBe(false);
    expect(list.allowsUnclaimedHandle('mallory', false)).toBe(false);
    expect(new Allowlist('', lower).allowsUnclaimedHandle('anyone', true)).toBe(true);
  });
});

describe('account and key owner access', () => {
  const saved = env.GITHUB_ALLOWED_USERS;
  afterEach(() => {
    env.GITHUB_ALLOWED_USERS = saved;
  });

  const user = '11111111-1111-4111-8111-111111111111';
  const account = (provider: string, pinned: string[] = []): Account => ({
    id: user,
    displayName: 'x',
    identities: [{ id: 'i', provider, subject: '1', username: 'alice', pinnedEntries: pinned }],
  });
  const deps = (opts: { account?: Account | null; claim?: string | null; pinned?: boolean }) => ({
    getAccount: async () => opts.account ?? null,
    findLegacyClaim: async () => opts.claim ?? null,
    isAllowlistEntryPinned: async () => opts.pinned ?? false,
  });

  it('lets a github account in by its pin and stops it once the entry is gone', () => {
    env.GITHUB_ALLOWED_USERS = 'alice';
    expect(isAccountAllowed(account('github', ['alice']))).toBe(true);
    env.GITHUB_ALLOWED_USERS = 'bob';
    expect(isAccountAllowed(account('github', ['alice']))).toBe(false);
  });

  it('always lets the local dev account in, and never an unknown provider', () => {
    env.GITHUB_ALLOWED_USERS = 'bob';
    expect(isAccountAllowed(account('local'))).toBe(true);
    expect(isAccountAllowed(account('gone-provider'))).toBe(false);
    expect(isAccountAllowed({ id: user, displayName: 'x', identities: [] })).toBe(false);
  });

  it('stops a key of an account taken off the allowlist, and restores it when put back', async () => {
    env.GITHUB_ALLOWED_USERS = 'alice';
    const a = account('github', ['alice']);
    expect(await resolveKeyOwner(`user:${user}`, deps({ account: a }))).toEqual({
      allowed: true,
      address: `user:${user}`,
      operator: false,
    });
    env.GITHUB_ALLOWED_USERS = 'bob';
    expect((await resolveKeyOwner(`user:${user}`, deps({ account: a }))).allowed).toBe(false);
    env.GITHUB_ALLOWED_USERS = 'bob,alice';
    expect((await resolveKeyOwner(`user:${user}`, deps({ account: a }))).allowed).toBe(true);
  });

  it('refuses a key whose account no longer exists', async () => {
    expect((await resolveKeyOwner(`user:${user}`, deps({ account: null }))).allowed).toBe(false);
  });

  it('judges an unclaimed legacy github:<login> key by its login, while unpinned', async () => {
    env.GITHUB_ALLOWED_USERS = 'alice';
    expect((await resolveKeyOwner('github:alice', deps({}))).allowed).toBe(true);
    expect((await resolveKeyOwner('github:mallory', deps({}))).allowed).toBe(false);
    expect((await resolveKeyOwner('github:alice', deps({ pinned: true }))).allowed).toBe(false);
    env.GITHUB_ALLOWED_USERS = '';
    expect((await resolveKeyOwner('github:mallory', deps({}))).allowed).toBe(true);
  });

  it('maps a claimed legacy key to its account and judges that account', async () => {
    env.GITHUB_ALLOWED_USERS = 'alice';
    const a = account('github', ['alice']);
    expect(await resolveKeyOwner('github:alice', deps({ claim: user, account: a }))).toEqual({
      allowed: true,
      address: `user:${user}`,
      operator: false,
    });
  });

  it('leaves operator-made owners alone', async () => {
    env.GITHUB_ALLOWED_USERS = 'alice';
    for (const owner of ['platform', `0x${'0'.repeat(64)}`, 'custom-address']) {
      expect(await resolveKeyOwner(owner, deps({}))).toEqual({
        allowed: true,
        address: owner,
        operator: false,
      });
    }
  });

  it('maps stored owners to the address that owns them now', async () => {
    expect(await currentOwnerAddress('github:alice', deps({ claim: user }))).toBe(`user:${user}`);
    expect(await currentOwnerAddress('github:alice', deps({}))).toBe('github:alice');
    expect(await currentOwnerAddress(`user:${user}`, deps({ claim: 'x' }))).toBe(`user:${user}`);
    expect(await currentOwnerAddress('platform', deps({ claim: user }))).toBe('platform');
  });
});

describe('signInWarnings', () => {
  const saved = { ...env };
  afterEach(() => Object.assign(env, saved));

  it('warns about an unset allowlist but not about an explicit *', () => {
    env.GITHUB_CLIENT_ID = 'id';
    env.GITHUB_CLIENT_SECRET = 'secret';
    env.GITHUB_ALLOWED_USERS = '';
    const opts = { authDisabled: false, publicUrl: 'https://video.example.com' };
    expect(signInWarnings(opts)).toEqual([
      expect.stringContaining('GitHub sign-in has no allowlist'),
    ]);
    env.GITHUB_ALLOWED_USERS = '*';
    expect(signInWarnings(opts)).toEqual([]);
    env.GITHUB_ALLOWED_USERS = 'alice';
    expect(signInWarnings(opts)).toEqual([]);
  });

  it('warns about an http public url off localhost, where cookies are not Secure', () => {
    env.GITHUB_CLIENT_ID = undefined;
    expect(signInWarnings({ authDisabled: false, publicUrl: 'http://192.168.1.10:8080' })).toEqual([
      expect.stringContaining('PUBLIC_URL is http on 192.168.1.10'),
    ]);
    expect(signInWarnings({ authDisabled: false, publicUrl: 'http://localhost:8080' })).toEqual([]);
    expect(signInWarnings({ authDisabled: true, publicUrl: 'http://192.168.1.10' })).toEqual([]);
  });
});

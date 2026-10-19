import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { Allowlist } from '../api/auth/allowlist.js';
import { isAccountAllowed, resolveKeyOwner, type Account } from '../api/auth/access.js';
import { signInWarnings } from '../api/auth/startup.js';

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
});

describe('account and key owner access', () => {
  const user = '11111111-1111-4111-8111-111111111111';
  const account = (
    provider: string,
    over: Partial<Pick<Account, 'role' | 'disabledAt'>> = {},
  ): Account => ({
    id: user,
    displayName: 'x',
    role: 'member',
    disabledAt: null,
    identities: [{ id: 'i', provider, subject: '1', username: 'alice' }],
    ...over,
  });
  const deps = (found: Account | null) => ({ getAccount: async () => found });

  it('lets a member in until an admin removes them', () => {
    expect(isAccountAllowed(account('github'))).toBe(true);
    expect(isAccountAllowed(account('password', { disabledAt: new Date() }))).toBe(false);
  });

  it('always lets the local dev account in', () => {
    expect(isAccountAllowed(account('local', { disabledAt: new Date() }))).toBe(true);
  });

  it('makes a key with no creator an admin', async () => {
    expect(await resolveKeyOwner({ createdBy: null }, deps(null))).toEqual({
      allowed: true,
      admin: true,
      userId: null,
    });
  });

  it("gives a key its creator's role, and stops it while the creator is removed", async () => {
    expect(await resolveKeyOwner({ createdBy: user }, deps(account('github')))).toEqual({
      allowed: true,
      admin: false,
      userId: user,
    });
    expect(
      await resolveKeyOwner({ createdBy: user }, deps(account('github', { role: 'admin' }))),
    ).toEqual({ allowed: true, admin: true, userId: user });
    expect(
      await resolveKeyOwner(
        { createdBy: user },
        deps(account('github', { role: 'admin', disabledAt: new Date() })),
      ),
    ).toMatchObject({ allowed: false, admin: false });
  });

  it('treats a creator whose row is gone like no creator, as the foreign key will', async () => {
    expect(await resolveKeyOwner({ createdBy: user }, deps(null))).toEqual({
      allowed: true,
      admin: true,
      userId: null,
    });
  });
});

describe('signInWarnings', () => {
  it('warns about an http public url off localhost, where cookies are not Secure', () => {
    expect(signInWarnings({ authDisabled: false, publicUrl: 'http://192.168.1.10:8080' })).toEqual([
      expect.stringContaining('PUBLIC_URL is http on 192.168.1.10'),
    ]);
    expect(signInWarnings({ authDisabled: false, publicUrl: 'http://localhost:8080' })).toEqual([]);
    expect(signInWarnings({ authDisabled: false, publicUrl: 'https://video.example.com' })).toEqual(
      [],
    );
    expect(signInWarnings({ authDisabled: true, publicUrl: 'http://192.168.1.10' })).toEqual([]);
  });
});

/**
 * In-memory accounts, sessions and keys with the contract of the postgres
 * queries (db/queries/accounts.ts, sessions.ts), for route and middleware
 * tests. The queries themselves are tested against postgres in
 * db-accounts.pg.test.ts.
 */
import type { Account } from '../../api/auth/access.js';
import type { CallerDeps, StoredApiKey } from '../../api/auth/caller.js';
import type { AuthRouteDeps } from '../../api/routes/auth.js';
import type { SignInInput, SignInResult } from '../../db/queries/accounts.js';
import type { LinkRecord, LinkRefusal } from '../../db/queries/invites.js';
import { hashApiKey } from '../../api/auth/api-key.js';
import { hashPassword } from '../../api/auth/password.js';
import { hashLinkToken, linkGone } from '../../api/auth/link-token.js';

interface StoredLink {
  id: string;
  tokenHash: string;
  kind: 'invite' | 'reset';
  role: 'admin' | 'member' | null;
  userId: string | null;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

interface StoredSession {
  id: string;
  userId: string;
  identityId: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function memoryAccounts() {
  let seq = 0;
  const users = new Map<
    string,
    { id: string; displayName: string; role: 'admin' | 'member'; disabledAt: Date | null }
  >();
  const identities: Array<{
    id: string;
    userId: string;
    provider: string;
    subject: string;
    username: string;
  }> = [];
  const sessions: StoredSession[] = [];
  const keys = new Map<string, StoredApiKey>(); // hash -> key
  const passwords = new Map<string, { email: string; passwordHash: string }>(); // user id ->
  const links: StoredLink[] = [];

  const live = (s: StoredSession) => !s.revokedAt && s.expiresAt > new Date();

  const getAccount = async (userId: string): Promise<Account | null> => {
    const user = users.get(userId);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      disabledAt: user.disabledAt,
      identities: identities
        .filter((i) => i.userId === userId)
        .map((i) => ({
          id: i.id,
          provider: i.provider,
          subject: i.subject,
          username: i.username,
        })),
    };
  };

  const createIdentity = (
    provider: string,
    subject: string,
    username: string,
    name: string,
    role: 'admin' | 'member' = 'member',
  ) => {
    const user = { id: uuid(++seq), displayName: name, role, disabledAt: null as Date | null };
    users.set(user.id, user);
    const identity = { id: uuid(++seq), userId: user.id, provider, subject, username };
    identities.push(identity);
    return identity;
  };

  // only members sign in: an identity nobody added is refused, as is a removed member
  const signIn = async (input: SignInInput): Promise<SignInResult> => {
    const identity = identities.find(
      (i) => i.provider === input.provider && i.subject === input.subject,
    );
    if (!identity) return { status: 'refused', reason: 'not_a_member' };
    const user = users.get(identity.userId)!;
    if (user.disabledAt) return { status: 'refused', reason: 'disabled' };
    identity.username = input.username;
    user.displayName = input.displayName;
    return {
      status: 'signed_in',
      userId: identity.userId,
      identityId: identity.id,
      displayName: input.displayName,
    };
  };

  let dev: { userId: string; username: string; displayName: string } | undefined;
  const localDevAccount = async () => {
    if (!dev) {
      const identity = createIdentity('local', 'dev', 'dev', 'Local developer', 'admin');
      dev = { userId: identity.userId, username: 'dev', displayName: 'Local developer' };
    }
    return dev;
  };

  const callerDeps: CallerDeps = {
    getAccount,
    findApiKeyByHash: async (hash) => keys.get(hash) ?? null,
    recordKeyUse: () => {},
    findActiveSession: async (id) => {
      const s = sessions.find((x) => x.id === id && live(x));
      return (
        s && {
          id: s.id,
          userId: s.userId,
          identityId: s.identityId,
          expiresAt: s.expiresAt,
          lastSeenAt: s.lastSeenAt,
        }
      );
    },
    findSession: async (id) => sessions.find((x) => x.id === id),
    markSessionSeen: (id) => {
      const s = sessions.find((x) => x.id === id);
      if (s) s.lastSeenAt = new Date();
    },
    localDevAccount,
  };

  const revokeAll = (userId: string, keepId?: string) => {
    const ended = sessions.filter((s) => s.userId === userId && !s.revokedAt && s.id !== keepId);
    for (const s of ended) s.revokedAt = new Date();
    return ended.length;
  };

  const emailOwner = (email: string) =>
    [...passwords.entries()].find(([, p]) => p.email === email)?.[0];

  const addPassword = (userId: string, email: string, passwordHash: string) => {
    passwords.set(userId, { email, passwordHash });
    const identity = {
      id: uuid(++seq),
      userId,
      provider: 'password',
      subject: userId,
      username: email,
    };
    identities.push(identity);
    return identity;
  };

  const newPasswordAccount = (
    input: { name: string; email: string; passwordHash: string },
    role: 'admin' | 'member',
  ) => {
    const user = { id: uuid(++seq), displayName: input.name, role, disabledAt: null };
    users.set(user.id, user);
    const identity = addPassword(user.id, input.email, input.passwordHash);
    return { userId: user.id, identityId: identity.id };
  };

  const hasSignInAdmin = async () =>
    [...users.values()].some(
      (u) =>
        u.role === 'admin' &&
        !u.disabledAt &&
        identities.some((i) => i.userId === u.id && i.provider !== 'local'),
    );

  const toLinkRecord = (l: StoredLink): LinkRecord => ({
    id: l.id,
    kind: l.kind,
    role: l.role,
    userId: l.userId,
    email: l.userId ? (passwords.get(l.userId)?.email ?? null) : null,
    userDisabled: l.userId ? users.get(l.userId)?.disabledAt != null : false,
    expiresAt: l.expiresAt,
    usedAt: l.usedAt,
    revokedAt: l.revokedAt,
  });

  const claim = (tokenHash: string, kind: StoredLink['kind']): StoredLink | LinkRefusal => {
    const l = links.find((x) => x.tokenHash === tokenHash);
    if (!l || l.kind !== kind) return { status: 'not_found' };
    const gone = linkGone(l);
    return gone ? { status: 'gone', reason: gone } : l;
  };
  const refused = (r: StoredLink | LinkRefusal): r is LinkRefusal => 'status' in r;

  const authDeps: AuthRouteDeps = {
    signIn,
    getAccount,
    localDevAccount,
    findActiveSession: callerDeps.findActiveSession,
    markSessionSeen: callerDeps.markSessionSeen,
    findSession: callerDeps.findSession,
    createSession: async ({ userId, identityId, expiresAt, userAgent }) => {
      const row = {
        id: uuid(++seq),
        userId,
        identityId,
        userAgent,
        createdAt: new Date(Date.now() + seq),
        expiresAt,
        revokedAt: null,
        lastSeenAt: null,
      };
      sessions.push(row);
      return { id: row.id };
    },
    listActiveSessions: async (userId) =>
      sessions
        .filter((s) => s.userId === userId && live(s))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    revokeSession: async (id, userId) => {
      const s = sessions.find((x) => x.id === id && x.userId === userId && !x.revokedAt);
      if (!s) return false;
      s.revokedAt = new Date();
      return true;
    },
    revokeAllSessions: async (userId) => revokeAll(userId),
    revokeOtherSessions: async (userId, keepId) => revokeAll(userId, keepId),
    pruneSessions: async () => {},
    hasSignInAdmin,
    createFirstAdmin: async (input) => {
      if (await hasSignInAdmin()) return { status: 'admin_exists' };
      if (emailOwner(input.email)) return { status: 'email_taken' };
      return { status: 'created', ...newPasswordAccount(input, 'admin') };
    },
    findPasswordAccount: async (email) => {
      const userId = emailOwner(email);
      if (!userId) return null;
      const identity = identities.find((i) => i.userId === userId && i.provider === 'password')!;
      return {
        userId,
        identityId: identity.id,
        passwordHash: passwords.get(userId)!.passwordHash,
        disabled: users.get(userId)!.disabledAt !== null,
      };
    },
    recordSignIn: async () => {},
    getPasswordCredential: async (userId) => passwords.get(userId) ?? null,
    setPassword: async (userId, passwordHash) => {
      passwords.get(userId)!.passwordHash = passwordHash;
    },
    linkIdentity: async (userId, input) => {
      const existing = identities.find(
        (i) => i.provider === input.provider && i.subject === input.subject,
      );
      if (existing && existing.userId !== userId) return { status: 'already_linked' };
      if (existing) {
        existing.username = input.username;
        return { status: 'linked', identityId: existing.id };
      }
      const identity = { id: uuid(++seq), userId, ...input };
      identities.push(identity);
      return { status: 'linked', identityId: identity.id };
    },
    findLink: async (tokenHash) => {
      const l = links.find((x) => x.tokenHash === tokenHash);
      return l ? toLinkRecord(l) : null;
    },
    acceptInvite: async (tokenHash, input) => {
      const l = claim(tokenHash, 'invite');
      if (refused(l)) return l;
      if (emailOwner(input.email)) return { status: 'email_taken' };
      const created = newPasswordAccount(input, l.role ?? 'member');
      l.usedAt = new Date();
      return { status: 'joined', ...created };
    },
    acceptReset: async (tokenHash, input) => {
      const l = claim(tokenHash, 'reset');
      if (refused(l)) return l;
      const userId = l.userId!;
      if (users.get(userId)!.disabledAt) return { status: 'disabled' };
      let identityId: string;
      const existing = passwords.get(userId);
      if (existing) {
        existing.passwordHash = input.passwordHash;
        identityId = identities.find((i) => i.userId === userId && i.provider === 'password')!.id;
      } else {
        if (emailOwner(input.email!)) return { status: 'email_taken' };
        identityId = addPassword(userId, input.email!, input.passwordHash).id;
      }
      revokeAll(userId);
      l.usedAt = new Date();
      return { status: 'reset', userId, identityId };
    },
    joinWithIdentity: async (tokenHash, input) => {
      const l = claim(tokenHash, 'invite');
      if (refused(l)) return l;
      if (identities.some((i) => i.provider === input.provider && i.subject === input.subject)) {
        return { status: 'already_linked' };
      }
      const identity = createIdentity(
        input.provider,
        input.subject,
        input.username,
        input.displayName,
        l.role ?? 'member',
      );
      l.usedAt = new Date();
      return { status: 'joined', userId: identity.userId, identityId: identity.id };
    },
  };

  return {
    users,
    identities,
    sessions,
    passwords,
    links,
    callerDeps,
    authDeps,
    /** A member who signs in with an email and password. */
    async addPasswordAccount(
      email: string,
      password: string,
      opts: { role?: 'admin' | 'member'; name?: string } = {},
    ) {
      return newPasswordAccount(
        { name: opts.name ?? email, email, passwordHash: await hashPassword(password) },
        opts.role ?? 'member',
      );
    },
    /** An invite or reset link for `token`, valid for a week unless told otherwise. */
    addLink(token: string, fields: Partial<Omit<StoredLink, 'id' | 'tokenHash'>> = {}): StoredLink {
      const kind = fields.kind ?? 'invite';
      const link: StoredLink = {
        id: uuid(++seq),
        tokenHash: hashLinkToken(token),
        kind,
        role: fields.role ?? (kind === 'invite' ? 'member' : null),
        userId: fields.userId ?? null,
        createdBy: fields.createdBy ?? null,
        createdAt: fields.createdAt ?? new Date(),
        expiresAt: fields.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
        usedAt: fields.usedAt ?? null,
        revokedAt: fields.revokedAt ?? null,
      };
      links.push(link);
      return link;
    },
    /** A member of the workspace who signs in through `provider`. */
    addAccount(
      provider: string,
      subject: string,
      username: string,
      role: 'admin' | 'member' = 'member',
    ) {
      return createIdentity(provider, subject, username, username, role);
    },
    /** Remove a member, as an admin does: their sessions and keys stop. */
    disable(userId: string) {
      users.get(userId)!.disabledAt = new Date();
    },
    restore(userId: string) {
      users.get(userId)!.disabledAt = null;
    },
    setRole(userId: string, role: 'admin' | 'member') {
      users.get(userId)!.role = role;
    },
    addKey(raw: string, key: Partial<StoredApiKey> = {}) {
      const stored: StoredApiKey = {
        id: key.id ?? `key-${++seq}`,
        name: key.name ?? 'test key',
        scopes: key.scopes ?? ['upload', 'read', 'manage'],
        rateLimit: key.rateLimit ?? 100,
        creatorAddress: key.creatorAddress ?? 'workspace',
        createdBy: key.createdBy ?? null,
        isActive: key.isActive ?? true,
        expiresAt: key.expiresAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      };
      keys.set(hashApiKey(raw), stored);
      return stored;
    },
  };
}

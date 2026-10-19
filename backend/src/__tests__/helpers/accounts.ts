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
import { hashApiKey } from '../../api/auth/api-key.js';

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
    revokeAllSessions: async (userId) => {
      const mine = sessions.filter((s) => s.userId === userId && !s.revokedAt);
      for (const s of mine) s.revokedAt = new Date();
      return mine.length;
    },
    pruneSessions: async () => {},
  };

  return {
    users,
    identities,
    sessions,
    callerDeps,
    authDeps,
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

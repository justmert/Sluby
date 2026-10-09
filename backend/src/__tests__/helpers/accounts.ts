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
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function memoryAccounts() {
  let seq = 0;
  const users = new Map<string, { id: string; displayName: string }>();
  const identities: Array<{
    id: string;
    userId: string;
    provider: string;
    subject: string;
    username: string;
  }> = [];
  const pins = new Map<string, string>(); // `${provider}\n${entry}` -> subject
  const claims = new Map<string, string>(); // legacy address -> user id
  const sessions: StoredSession[] = [];
  const keys = new Map<string, StoredApiKey>(); // hash -> key

  const live = (s: StoredSession) => !s.revokedAt && s.expiresAt > new Date();

  const getAccount = async (userId: string): Promise<Account | null> => {
    const user = users.get(userId);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.displayName,
      identities: identities
        .filter((i) => i.userId === userId)
        .map((i) => ({
          id: i.id,
          provider: i.provider,
          subject: i.subject,
          username: i.username,
          pinnedEntries: [...pins]
            .filter(([k, subject]) => k.startsWith(`${i.provider}\n`) && subject === i.subject)
            .map(([k]) => k.split('\n')[1]),
        })),
    };
  };

  const createIdentity = (provider: string, subject: string, username: string, name: string) => {
    const user = { id: uuid(++seq), displayName: name };
    users.set(user.id, user);
    const identity = { id: uuid(++seq), userId: user.id, provider, subject, username };
    identities.push(identity);
    return identity;
  };

  const signIn = async (input: SignInInput): Promise<SignInResult> => {
    const providerPins = new Map(
      [...pins]
        .filter(([k]) => k.startsWith(`${input.provider}\n`))
        .map(([k, s]) => [k.split('\n')[1], s]),
    );
    const decision = input.decide(providerPins);
    if (!decision.allowed) return { status: 'refused' };
    if (decision.pin) pins.set(`${input.provider}\n${decision.pin}`, input.subject);
    let identity = identities.find(
      (i) => i.provider === input.provider && i.subject === input.subject,
    );
    if (identity) {
      identity.username = input.username;
      users.get(identity.userId)!.displayName = input.displayName;
    } else {
      identity = createIdentity(input.provider, input.subject, input.username, input.displayName);
      if (input.legacyAddress && !claims.has(input.legacyAddress)) {
        claims.set(input.legacyAddress, identity.userId);
      }
    }
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
      const identity = createIdentity('local', 'dev', 'dev', 'Local developer');
      dev = { userId: identity.userId, username: 'dev', displayName: 'Local developer' };
    }
    return dev;
  };

  const callerDeps: CallerDeps = {
    getAccount,
    findLegacyClaim: async (address) => claims.get(address) ?? null,
    isAllowlistEntryPinned: async (provider, entry) => pins.has(`${provider}\n${entry}`),
    findApiKeyByHash: async (hash) => keys.get(hash) ?? null,
    recordKeyUse: () => {},
    findActiveSession: async (id) => {
      const s = sessions.find((x) => x.id === id && live(x));
      return s && { id: s.id, userId: s.userId, identityId: s.identityId, expiresAt: s.expiresAt };
    },
    localDevAccount,
  };

  const authDeps: AuthRouteDeps = {
    signIn,
    getAccount,
    localDevAccount,
    findActiveSession: callerDeps.findActiveSession,
    createSession: async ({ userId, identityId, expiresAt, userAgent }) => {
      const row = {
        id: uuid(++seq),
        userId,
        identityId,
        userAgent,
        createdAt: new Date(Date.now() + seq),
        expiresAt,
        revokedAt: null,
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
    pins,
    claims,
    sessions,
    callerDeps,
    authDeps,
    /** An account signed in once through `provider`, without the allowlist. */
    addAccount(provider: string, subject: string, username: string) {
      return createIdentity(provider, subject, username, username);
    },
    pin(provider: string, entry: string, subject: string) {
      pins.set(`${provider}\n${entry}`, subject);
    },
    addKey(raw: string, key: Partial<StoredApiKey> & { creatorAddress: string }) {
      const stored: StoredApiKey = {
        id: key.id ?? `key-${++seq}`,
        name: key.name ?? 'test key',
        scopes: key.scopes ?? ['upload', 'read', 'manage'],
        rateLimit: key.rateLimit ?? 100,
        creatorAddress: key.creatorAddress,
        isActive: key.isActive ?? true,
        expiresAt: key.expiresAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      };
      keys.set(hashApiKey(raw), stored);
      return stored;
    },
  };
}

import { env } from '../../config/env.js';
import { hashApiKey } from './api-key.js';
import {
  resolveSession,
  whySessionEnded,
  type FindActiveSession,
  type FindSession,
  type SessionEndReason,
} from './session.js';
import { resolveKeyOwner, type OwnerAccessDeps } from './access.js';
import { isOperatorAccount } from './operators.js';
import { userAddress } from '../ownership.js';

// what a 401 says, by why the cookie did not count; with no cookie at all the
// request simply lacked credentials
const ENDED: Record<SessionEndReason, string> = {
  missing: 'Missing or invalid Authorization header',
  expired: 'This session has expired',
  revoked: 'This session was signed out',
  not_allowed: 'This account is not allowed on this server',
};

/** Who is making a request, as every route and tus see it. */
export interface Caller {
  /** The key id, or `session:<user id>` for a Studio session or the dev account. */
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  creatorAddress: string;
  /**
   * The operator role (OPERATOR_USERS, see operators.ts): deployment-wide
   * operations data, never other accounts' data. Decided on every request.
   */
  operator: boolean;
}

const ALL_SCOPES = ['upload', 'read', 'manage'];

export interface StoredApiKey {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  creatorAddress: string;
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

export interface CallerDeps extends OwnerAccessDeps {
  findApiKeyByHash: (hash: string) => Promise<StoredApiKey | null>;
  /** Note that a key authenticated; must not throw or wait (see key-usage.ts). */
  recordKeyUse: (id: string, lastUsedAt: Date | null) => void;
  findActiveSession: FindActiveSession;
  /** Any session row, to say why a cookie no longer signs in (see whySessionEnded). */
  findSession: FindSession;
  /** Note a session was used now; must not throw or wait. */
  markSessionSeen: (sid: string) => void;
  /** The local dev account AUTH_DISABLED runs as, created on first use. */
  localDevAccount: () => Promise<{ userId: string; username: string; displayName: string }>;
}

export type CallerResult =
  | { ok: true; caller: Caller }
  /** `reason` is set when no key was sent, so the request was a browser's session. */
  | { ok: false; error: string; reason?: SessionEndReason };

// a studio session drives the whole api for its account, like a full key
function accountCaller(userId: string, username: string, operator: boolean): Caller {
  return {
    id: `session:${userId}`,
    name: `Studio session (${username})`,
    scopes: ALL_SCOPES,
    rateLimit: 1000,
    creatorAddress: userAddress(userId),
    operator,
  };
}

/**
 * Resolve the caller of a request, the same way for the REST api and tus:
 * AUTH_DISABLED first (every request is the local dev account), then a Studio
 * session cookie, then a bearer API key. A cookie wins over a key, since the
 * Studio sends both only when the session is the one meant.
 */
export async function resolveCaller(
  headers: { cookie?: string; authorization?: string },
  deps: CallerDeps,
): Promise<CallerResult> {
  if (env.AUTH_DISABLED) {
    // the one local user runs the deployment, so it sees its operations
    const dev = await deps.localDevAccount();
    return { ok: true, caller: accountCaller(dev.userId, dev.username, true) };
  }

  const signedIn = await resolveSession(headers.cookie, {
    secret: env.SESSION_SECRET,
    findActiveSession: deps.findActiveSession,
    getAccount: deps.getAccount,
    markSeen: deps.markSessionSeen,
  });
  if (signedIn) {
    const identity = signedIn.account.identities.find((i) => i.id === signedIn.session.identityId);
    return {
      ok: true,
      caller: accountCaller(
        signedIn.account.id,
        identity?.username ?? signedIn.account.displayName,
        isOperatorAccount(signedIn.account),
      ),
    };
  }

  const auth = headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    const reason = await whySessionEnded(headers.cookie, {
      secret: env.SESSION_SECRET,
      findSession: deps.findSession,
      getAccount: deps.getAccount,
    });
    return { ok: false, error: ENDED[reason], reason };
  }
  const key = await deps.findApiKeyByHash(hashApiKey(auth.slice(7)));
  if (!key) return { ok: false, error: 'Invalid API key' };
  if (!key.isActive) return { ok: false, error: 'API key is deactivated' };
  if (key.expiresAt && key.expiresAt < new Date()) {
    return { ok: false, error: 'API key has expired' };
  }

  const owner = await resolveKeyOwner(key.creatorAddress, deps);
  if (!owner.allowed) {
    return { ok: false, error: "API key's account is not allowed on this server" };
  }
  deps.recordKeyUse(key.id, key.lastUsedAt);
  return {
    ok: true,
    caller: {
      id: key.id,
      name: key.name,
      scopes: key.scopes,
      rateLimit: key.rateLimit,
      creatorAddress: owner.address,
      operator: owner.operator,
    },
  };
}

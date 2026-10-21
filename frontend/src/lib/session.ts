import { createContext, useContext } from 'react';
import { SlubyError } from '@sluby/sdk';
import { ApiError } from './api-client';

export type Role = 'admin' | 'member';

/** One way an account signs in: `password` with the email, `github` with the login. */
export interface SignInMethod {
  provider: string;
  username: string;
}

/** The signed-in account, from GET /auth/me. */
export interface AuthSession {
  /** The account id. */
  id: string;
  /** The account's display name. */
  name: string;
  /** The handle of the identity this browser signed in with, e.g. the GitHub login. */
  username: string;
  /** Which sign-in provider that identity belongs to, e.g. "github", or "local" in dev mode. */
  provider: string | null;
  providerLabel: string | null;
  /** True when the server runs with AUTH_DISABLED and everyone is the local account. */
  authDisabled: boolean;
  role: Role;
  /**
   * Admins see deployment-wide status, metrics and reconciliation, and
   * manage members and invites.
   */
  admin: boolean;
  /** Every way the account signs in, such as its password email and GitHub login. */
  signIn: SignInMethod[];
  /** When the session ends; null when sign-in is disabled. */
  expiresAt: string | null;
}

/** GET /auth/me as the api sends it. */
export interface MeResponse {
  id: string;
  name: string;
  username: string;
  provider: string | null;
  provider_label: string | null;
  auth_disabled: boolean;
  /** Absent on servers from before roles, which means member. */
  role?: Role;
  sign_in?: SignInMethod[];
  expires_at: string | null;
}

export function sessionFromMe(me: MeResponse): AuthSession {
  // the deprecated `operator` alias is not read: role says the same
  const role: Role = me.role === 'admin' ? 'admin' : 'member';
  return {
    id: me.id,
    name: me.name,
    username: me.username,
    provider: me.provider,
    providerLabel: me.provider_label,
    authDisabled: me.auth_disabled === true,
    role,
    admin: role === 'admin',
    signIn: Array.isArray(me.sign_in) ? me.sign_in : [],
    expiresAt: me.expires_at ?? null,
  };
}

export const SessionContext = createContext<AuthSession | null>(null);

/** Read the signed-in account again, after it changed its own name or ways in. */
export const SessionRefreshContext = createContext<() => Promise<void>>(async () => {});

/** Re-reads the session the AuthGate holds; for Settings after an account change. */
export function useRefreshSession(): () => Promise<void> {
  return useContext(SessionRefreshContext);
}

/** The signed-in Studio session. Only valid below the AuthGate. */
export function useSession(): AuthSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used below AuthGate');
  return session;
}

/**
 * Why a session ended, from the `reason` of a session 401 (plan B-11):
 * `{ error, reason }`. Servers before B-11 send no reason.
 */
export type SessionEndReason = 'missing' | 'expired' | 'revoked' | 'not_allowed';

const END_REASONS: readonly SessionEndReason[] = ['missing', 'expired', 'revoked', 'not_allowed'];

function bodyOf(err: unknown): unknown {
  if (err instanceof ApiError) return err.body;
  if (err instanceof SlubyError && err.responseBody) {
    try {
      return JSON.parse(err.responseBody);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The reason a 401 gave, from apiClient or the sdk; undefined when it gave none we know. */
export function sessionEndReasonOf(err: unknown): SessionEndReason | undefined {
  const reason = (bodyOf(err) as { reason?: unknown } | null | undefined)?.reason;
  return END_REASONS.includes(reason as SessionEndReason)
    ? (reason as SessionEndReason)
    : undefined;
}

/**
 * The `?signin_error=` codes the GitHub callback sends back to the studio
 * (backend routes/auth.ts). `cancelled` is the person backing out at GitHub.
 */
export type SignInError =
  | 'expired_handshake'
  | 'not_a_member'
  | 'disabled'
  | 'already_linked'
  | 'not_signed_in'
  | 'invite_not_found'
  | 'invite_used'
  | 'invite_expired'
  | 'invite_revoked'
  | 'cancelled'
  | 'provider_failed'
  | 'not_configured';

import { createContext, useContext } from 'react';
import { SlubyError } from '@sluby/sdk';
import { ApiError } from './api-client';

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
  /** Operators see deployment-wide status, metrics and reconciliation. */
  operator: boolean;
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
  /** Absent on servers older than the operator role, which means no. */
  operator?: boolean;
  expires_at: string | null;
}

export function sessionFromMe(me: MeResponse): AuthSession {
  return {
    id: me.id,
    name: me.name,
    username: me.username,
    provider: me.provider,
    providerLabel: me.provider_label,
    authDisabled: me.auth_disabled === true,
    operator: me.operator === true,
    expiresAt: me.expires_at ?? null,
  };
}

export const SessionContext = createContext<AuthSession | null>(null);

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
 * (plan B-12). `cancelled` is the person backing out at GitHub.
 */
export type SignInError =
  'expired_handshake' | 'not_allowed' | 'cancelled' | 'provider_failed' | 'not_configured';

import { ApiError, retryAfterOf, statusOf } from '@/lib/api-client';
import { errorText } from '@/lib/errors';
import type { SessionEndReason, SignInError } from '@/lib/session';

/** What the sign-in screen says about a session that ended. Null says nothing. */
export function endedMessage(ended: boolean, reason: SessionEndReason | undefined): string | null {
  switch (reason) {
    case 'expired':
      return 'Your session expired. Sign in again to continue.';
    case 'revoked':
      return 'You were signed out from another browser.';
    case 'not_allowed':
      return 'Your account was removed from this workspace. Ask an admin to restore it.';
    default:
      // "missing" means no session cookie came with the request: on a first
      // visit that is just signed out, mid-session it means the cookie went
      return ended ? 'Your session ended. Sign in again to continue.' : null;
  }
}

export interface SignInFailure {
  code: SignInError | string;
  /** The GitHub login that was refused, when the server named it. */
  handle: string | null;
}

const NEW_LINK = 'Ask an admin for a new one.';

/** Why the last GitHub sign-in did not finish, as the callback put it in the url. */
export function signInFailureText({ code, handle }: SignInFailure): string {
  const account = handle ? `GitHub account ${handle}` : 'That GitHub account';
  switch (code) {
    case 'expired_handshake':
      return 'That sign-in link expired. Try again.';
    case 'not_a_member':
      return `${account} is not a member of this workspace. Ask an admin for an invite.`;
    case 'disabled':
      return 'This account was removed from this workspace. Ask an admin to restore it.';
    case 'already_linked':
      return `${account} already belongs to another member.`;
    case 'not_signed_in':
      return 'Sign in first, then link GitHub from Settings.';
    case 'invite_not_found':
      return `That invite link does not exist. ${NEW_LINK}`;
    case 'invite_used':
      return `That invite link was already used. ${NEW_LINK}`;
    case 'invite_expired':
      return `That invite link has expired. ${NEW_LINK}`;
    case 'invite_revoked':
      return `That invite link was withdrawn. ${NEW_LINK}`;
    case 'cancelled':
      return 'Sign-in was canceled on GitHub.';
    case 'provider_failed':
      return 'GitHub did not confirm the sign-in. Try again.';
    case 'not_configured':
      return 'Sign-in with GitHub is not set up on this server.';
    default:
      return 'Sign-in did not finish. Try again.';
  }
}

/**
 * Read `signin_error` (and `handle`) once and take them out of the url, so a
 * reload or a shared link does not show the failure again and the next
 * sign-in does not carry it back as its `next`.
 */
export function takeSignInFailure(): SignInFailure | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('signin_error');
  if (code === null) return null;
  const handle = url.searchParams.get('handle');
  url.searchParams.delete('signin_error');
  url.searchParams.delete('handle');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return { code, handle };
}

/** The `reason` of an api error body, if it has one. */
export function reasonOf(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const reason = (err.body as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

const REMOVED = 'This account was removed from this workspace. Ask an admin to restore it.';

/**
 * The sentence for a failed sign-in, setup or link form. The attempt limits
 * count in minutes, so a 429 says minutes rather than the general "wait N
 * seconds".
 */
export function authErrorText(err: unknown): string {
  if (err instanceof SessionNotKeptError) return err.message;
  const status = statusOf(err);
  if (status === 429) {
    const seconds = retryAfterOf(err);
    if (seconds === undefined) return 'Too many attempts. Wait a few minutes and try again.';
    if (seconds < 60) {
      return `Too many attempts. Try again in ${seconds === 1 ? 'a second' : `${seconds} seconds`}.`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `Too many attempts. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`;
  }
  if (status === 404) return `This link does not exist. ${NEW_LINK}`;
  if (status === 410) {
    const reason = reasonOf(err);
    const why =
      reason === 'used'
        ? 'This link was already used.'
        : reason === 'revoked'
          ? 'This link was withdrawn.'
          : 'This link has expired.';
    return `${why} ${NEW_LINK}`;
  }
  if (status === 401 && reasonOf(err) === 'bad_credentials') return 'Wrong email or password.';
  if (status === 403 && reasonOf(err) === 'disabled') return REMOVED;
  return errorText(err);
}

/**
 * The server accepted the sign-in but the session check right after it found
 * no session: the browser did not keep the cookie.
 */
export class SessionNotKeptError extends Error {
  constructor() {
    super(
      'You signed in, but this browser did not keep the session. Allow cookies for this site and try again.',
    );
    this.name = 'SessionNotKeptError';
  }
}

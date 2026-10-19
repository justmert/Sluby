/** A person as a sign-in provider vouches for them after a completed sign-in. */
export interface ProviderProfile {
  /** The provider's stable id for the person, never a handle that can change hands. */
  subject: string;
  /** The handle the provider reports now (github: the login), display only. */
  username: string;
  /** A human name for the account, display only. */
  displayName: string;
}

/**
 * Why a sign-in did not complete: the person cancelled it, the redirect back
 * was malformed, or the provider failed. `message` is fixed text written
 * here, never provider or request input, because it is shown to the browser.
 */
export class SignInError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'invalid' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'SignInError';
  }
}

/**
 * One way to sign in to the Studio. Adding a provider is one module that
 * implements this and one line in providers/index.ts: the routes
 * (/api/v1/auth/<id>/login and /callback), the browser binding of the
 * handshake, accounts and sessions are shared.
 */
export interface SignInProvider {
  /** Stored in user_identities.provider and used in the route path. Never change it. */
  readonly id: string;
  /** Shown to people, e.g. "GitHub". */
  readonly label: string;
  /** Whether the operator configured this provider; unconfigured ones answer 500. */
  isConfigured(): boolean;
  /** Where to send the browser to start signing in. */
  authorizationUrl(opts: { state: string; callbackUrl: string }): string;
  /**
   * Finish a sign-in from the query the provider redirected back with, after
   * the shared code checked the state. Throws SignInError.
   */
  completeSignIn(
    query: Record<string, unknown>,
    opts: { callbackUrl: string },
  ): Promise<ProviderProfile>;
  /** A handle as the provider compares it (github: logins are case-insensitive). */
  normalizeHandle(handle: string): string;
}

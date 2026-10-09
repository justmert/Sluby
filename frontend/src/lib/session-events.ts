// a call came back 401 mid-session: the session expired, was ended from
// another browser, or the account left the allowlist. the auth gate listens
// and returns to sign-in. anything outside react query (the upload store)
// reports here too.

import type { SessionEndReason } from './session';

/** `reason` is the server's, when the 401 said why (plan B-11). */
type Listener = (reason?: SessionEndReason) => void;

const listeners = new Set<Listener>();

/** Tell the auth gate the session is no longer valid, and why when the server said. */
export function reportUnauthorized(reason?: SessionEndReason): void {
  for (const listener of [...listeners]) listener(reason);
}

/** Run `listener` whenever a call reports the session gone; returns the unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

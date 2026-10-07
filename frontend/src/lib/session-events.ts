// a call came back 401 mid-session: the session expired, was ended from
// another browser, or the account left the allowlist. the auth gate listens
// and returns to sign-in. anything outside react query (the upload store)
// reports here too.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Tell the auth gate the session is no longer valid. */
export function reportUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}

/** Run `listener` whenever a call reports the session gone; returns the unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// one polite live region for the whole studio (AppShell's Announcer). pages
// say things through it instead of mounting regions of their own: a region
// that mounts with its text in it is often not read, and several regions
// changing at once read over each other.

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** Have screen readers read `message` once, politely, after what they are reading now. */
export function announce(message: string): void {
  for (const listener of [...listeners]) listener(message);
}

/** For the Announcer: hear every message; returns the unsubscribe. */
export function onAnnounce(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

import { useSyncExternalStore, type ComponentType } from 'react';

/*
 * the sheet's panel stays out of the first load, but the shell starts
 * fetching it as soon as it mounts, and the sheet opens only once it is here.
 * so the sheet always shows up with its drafts and a focused title in one
 * commit, and keys typed the moment it appears land in that title.
 */

export type PanelState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; Panel: ComponentType }
  | { status: 'failed'; error: unknown };

let state: PanelState = { status: 'idle' };
const listeners = new Set<() => void>();

const set = (next: PanelState) => {
  state = next;
  listeners.forEach((l) => l());
};

function load() {
  set({ status: 'loading' });
  import('./StudioUploadPanel').then(
    (m) => set({ status: 'ready', Panel: m.default }),
    (error: unknown) => set({ status: 'failed', error }),
  );
}

/** Start fetching the panel, once; later calls do nothing unless it failed. */
export function loadUploadPanel() {
  if (state.status === 'idle' || state.status === 'failed') load();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUploadPanel(): PanelState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

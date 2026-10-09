import { useEffect, useRef } from 'react';
import { onUnauthorized } from './session-events';
import { useSession } from './session';
import { toastSuccess } from './toast';

/*
 * a form's draft survives the session ending under it (FLW-15): when a call
 * reports the session gone, the draft goes to sessionStorage before the gate
 * takes the page away, and the same form gets it back after signing in
 * again. sessionStorage is per tab and outlives the github round trip.
 */

const PREFIX = 'sluby:draft:';

export const RESTORED_DRAFT_MESSAGE = 'Restored what you typed before you were signed out.';

interface Stored {
  /** The account that typed it; another account signing in on this tab never sees it. */
  account: string;
  value: unknown;
}

// storage can be off or full (private windows, blocked site data); the draft
// is then not kept, which is what happened before this existed
function write(key: string, stored: Stored) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(stored));
  } catch (err) {
    console.warn('Could not keep the draft for after sign-in', err);
  }
}

function take(key: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    sessionStorage.removeItem(PREFIX + key);
    return JSON.parse(raw) as Stored;
  } catch (err) {
    console.warn('Could not read the draft kept from before sign-in', err);
    return null;
  }
}

/**
 * Keep `value` if the session ends while this component is mounted, and hand
 * it to `restore` the next time a component with the same `key` mounts for
 * the same account, with a toast saying so.
 *
 * - `key` names the form, such as "create-key" or "add-webhook".
 * - `value` is what to keep, as plain JSON data; null when there is nothing
 *   worth keeping (the dialog is closed, the fields are empty).
 * - `restore` gets the kept value once; open the dialog and fill it there.
 *
 *     usePersistedDraft('create-key', open ? form : null, (draft) => {
 *       setForm(draft);
 *       setOpen(true);
 *     });
 */
export function usePersistedDraft<T>(
  key: string,
  value: T | null,
  restore: (value: T) => void,
): void {
  const { id: account } = useSession();
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });

  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    const stored = take(key);
    if (stored && stored.account === account && stored.value !== null) {
      restoreRef.current(stored.value as T);
      toastSuccess(RESTORED_DRAFT_MESSAGE);
    }
  }, [key, account]);

  useEffect(
    () =>
      onUnauthorized(() => {
        if (latest.current !== null) write(key, { account, value: latest.current });
      }),
    [key, account],
  );
}

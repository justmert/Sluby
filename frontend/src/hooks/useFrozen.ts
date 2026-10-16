import { useState } from 'react';

/**
 * Holds on to the last value seen while `open` is true, so a dialog that is
 * animating closed keeps showing what it was opened for even after the page
 * has cleared its state. Without it a delete dialog reads "Delete undefined
 * videos?" for the length of its exit animation.
 *
 *   const [pending, setPending] = useState<string[] | null>(null);
 *   const open = pending !== null;
 *   const shown = useFrozen(pending, open);
 *   <AlertDialog open={open} onOpenChange={(o) => !o && setPending(null)}>
 *     <AlertDialogTitle>Delete {shown?.length} videos?</AlertDialogTitle>
 */
export function useFrozen<T>(value: T, open: boolean): T {
  const [frozen, setFrozen] = useState(value);
  // react's documented way to keep state in step with a prop: update during
  // render, guarded so it settles after one pass
  if (open && !Object.is(frozen, value)) setFrozen(value);
  return open ? value : frozen;
}

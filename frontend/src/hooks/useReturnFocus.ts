import { useRef } from 'react';

type FocusHandler = (event: Event) => void;

/**
 * Gives focus back to whatever had it when a dialog opened, once it closes.
 * Radix returns focus to its Trigger, but the studio opens most dialogs from
 * state (a row menu, a button elsewhere), so without this focus fell to
 * <body> and the next Tab started over at the skip link. A handler the
 * caller passes still runs first and can call preventDefault to opt out.
 */
export function useReturnFocus(onOpenAutoFocus?: FocusHandler, onCloseAutoFocus?: FocusHandler) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const el = opener.current;
      opener.current = null;
      if (event.defaultPrevented) return;
      if (el?.isConnected) {
        event.preventDefault();
        el.focus();
      }
    },
  };
}

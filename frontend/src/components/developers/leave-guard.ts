import { useEffect, useRef, useState } from 'react';

// marks the history entry the guard adds on top of the page while it holds
const GUARD_STATE = 'slubyLeaveGuard';
// the pending value for the browser's back button, which has no url to give
const BACK = '#back';

const isGuardEntry = (state: unknown) =>
  typeof state === 'object' && state !== null && GUARD_STATE in state;

const pushGuardEntry = () =>
  window.history.pushState(
    { ...(window.history.state ?? {}), [GUARD_STATE]: true },
    '',
    window.location.href,
  );

/**
 * Holds the page while a secret that is shown once sits on it uncopied: a
 * reload or a closed tab gets the browser's own warning, and a click on a
 * link inside the app or the browser's back button is held until `leave` or
 * `stay` answers. The studio uses a BrowserRouter, which has no navigation
 * blocker, so links are caught here, and back is caught with an extra history
 * entry for this same page: going back lands on the page again, where the
 * question is asked. Code that calls navigate() is not held.
 */
export function useLeaveGuard(active: boolean, navigate: (to: string) => void) {
  const [pending, setPending] = useState<string | null>(null);
  // set while the guard itself steps back through history, so the popstate
  // that causes is not taken for the person pressing back
  const leaving = useRef(false);
  // whether the guard added its history entry, so it is taken off once,
  // when the secret is copied, and not on every run of the effect
  const holding = useRef(false);

  useEffect(() => {
    if (!active) {
      // copied: drop the extra entry so back works as usual
      if (holding.current && !leaving.current && isGuardEntry(window.history.state)) {
        window.history.back();
      }
      holding.current = false;
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const here = window.location;
      if (url.pathname === here.pathname && url.search === here.search) return;
      // in the capture phase on the document, so the router's own click
      // handler on the link never runs
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    const onPopState = (e: PopStateEvent) => {
      if (leaving.current || isGuardEntry(e.state)) return;
      // back took the guard entry off: put it back and ask first
      pushGuardEntry();
      setPending(BACK);
    };
    if (!isGuardEntry(window.history.state)) pushGuardEntry();
    holding.current = true;
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [active]);

  return {
    /** where a held link was going, or '#back' for the back button, while the question is open */
    pending: active ? pending : null,
    leave: () => {
      const to = pending;
      setPending(null);
      if (to === BACK) {
        // past the guard entry and this page, to where back was going
        leaving.current = true;
        window.history.go(-2);
      } else if (to) {
        navigate(to);
      }
    },
    stay: () => setPending(null),
  };
}

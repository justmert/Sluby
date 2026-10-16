import { useEffect, useState } from 'react';

/**
 * Holds the page while a secret that is shown once sits on it uncopied: a
 * reload or a closed tab gets the browser's own warning, and a click on a
 * link inside the app is held until `leave` or `stay` answers. The studio
 * uses a BrowserRouter, which has no navigation blocker, so links are caught
 * here; the browser's back button and code that calls navigate() are not.
 */
export function useLeaveGuard(active: boolean, navigate: (to: string) => void) {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
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
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return {
    /** where a held link was going, while the question is open */
    pending: active ? pending : null,
    leave: () => {
      const to = pending;
      setPending(null);
      if (to) navigate(to);
    },
    stay: () => setPending(null),
  };
}

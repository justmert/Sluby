import { useEffect, type RefObject } from 'react';

/** Whether a key press came from somewhere that takes typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * "/" moves focus to a page's search field, as on GitHub and most docs
 * sites. It leaves alone keys typed into a field, keys with a modifier, and
 * keys something else already handled (an open menu or dialog).
 *
 *   const search = useRef<HTMLInputElement>(null);
 *   useSlashToSearch(search);
 *   <input ref={search} aria-keyshortcuts="/" />
 */
export function useSlashToSearch(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || !ref.current) return;
      e.preventDefault();
      ref.current.focus();
      ref.current.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}

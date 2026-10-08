import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
// below this the full sidebar leaves too little room for the pages (tables
// and two-column cards squeeze), so it starts as an icon rail; tailwind xl
export const WIDE_BREAKPOINT = 1280;

/** Whether `query` matches, following changes live. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

export function useIsWide() {
  return useMediaQuery(`(min-width: ${WIDE_BREAKPOINT}px)`);
}

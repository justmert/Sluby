import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { THEME_STORAGE_KEY, ThemeContext, parseTheme, resolveTheme, type Theme } from '@/lib/theme';

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribeToSystem(onChange: () => void) {
  const mq = systemQuery();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function readStoredTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // storage can be blocked (private mode); fall back to the default
    return parseTheme(null);
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs a theme change inside a view transition, so the browser crossfades one
 * snapshot of the page (see ::view-transition in index.css). Fading every
 * element's colors instead started about 2,600 css transitions at once and
 * dropped frames on a slow cpu. Without view transitions, or under reduced
 * motion, the theme snaps.
 */
function withCrossfade(apply: () => void) {
  if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
    apply();
    return;
  }
  document.startViewTransition(apply);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  // follows the os, including changes after load
  const systemDark = useSyncExternalStore(subscribeToSystem, () => systemQuery().matches);
  const resolvedTheme = resolveTheme(theme, systemDark);

  // a layout effect, so the class is on <html> by the time a view transition
  // takes its second snapshot
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // not persisted, but still applied for this session
    }
    withCrossfade(() => flushSync(() => setThemeState(next)));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

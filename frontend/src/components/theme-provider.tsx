import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  // follows the os, including changes after load
  const systemDark = useSyncExternalStore(subscribeToSystem, () => systemQuery().matches);
  const resolvedTheme = resolveTheme(theme, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // not persisted, but still applied for this session
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

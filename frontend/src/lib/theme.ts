import { createContext, useContext } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

// frontend/index.html applies the saved theme before first paint with its own
// copy of the key, the values and the default: an inline script, which the
// nginx csp allows by its hash. theme.test.ts runs that script against
// resolveTheme, so the two cannot drift apart unnoticed.

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sluby-theme';
export const THEME_VALUES: readonly Theme[] = ['light', 'dark', 'system'];
export const DEFAULT_THEME: Theme = 'dark';

export const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** A stored value as a theme; anything else is the default. */
export function parseTheme(stored: string | null): Theme {
  return THEME_VALUES.includes(stored as Theme) ? (stored as Theme) : DEFAULT_THEME;
}

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme !== 'system') return theme;
  return systemDark ? 'dark' : 'light';
}

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}

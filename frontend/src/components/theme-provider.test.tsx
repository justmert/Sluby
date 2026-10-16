import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, useTheme } from '@/lib/theme';
import { ThemeProvider } from './theme-provider';

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList);
  return {
    flip(next: boolean) {
      mq.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

describe('ThemeProvider', () => {
  it.each([
    [false, 'light'],
    [true, 'dark'],
  ])('with nothing saved follows the os (os dark %s) and puts the class on <html>', (dark, cls) => {
    mockSystem(dark);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(document.documentElement).toHaveClass(cls);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    vi.restoreAllMocks();
  });

  it('applies and persists an explicit choice', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button', { name: 'light' }).click());
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores the saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement).toHaveClass('light');
  });

  it('follows the OS on system, including live changes', () => {
    const system = mockSystem(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button', { name: 'system' }).click());
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).toHaveClass('light');

    act(() => system.flip(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    vi.restoreAllMocks();
  });
});

describe('ThemeProvider switching', () => {
  it('switches inside a view transition when the browser has one', () => {
    const calls: string[] = [];
    const start = vi.fn((update: () => void) => {
      calls.push(`before:${document.documentElement.className}`);
      update();
      calls.push(`after:${document.documentElement.className}`);
    });
    Object.assign(document, { startViewTransition: start });
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button', { name: 'light' }).click());
    expect(start).toHaveBeenCalledTimes(1);
    // the class lands inside the callback, so the new snapshot shows the new theme
    expect(calls).toEqual(['before:dark', 'after:light']);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it('snaps without a view transition under reduced motion', () => {
    const start = vi.fn();
    Object.assign(document, { startViewTransition: start });
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('reduce'),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole('button', { name: 'light' }).click());
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveClass('light');
    vi.restoreAllMocks();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });
});

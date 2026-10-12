import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { renderPage } from '@/test/render';
import { AppearanceSection } from './AppearanceSection';

afterEach(() => vi.restoreAllMocks());

function systemDark(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: dark,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList);
}

describe('AppearanceSection', () => {
  it('says the default and that a choice is kept in this browser (FLW-55)', () => {
    renderPage(<AppearanceSection />);
    expect(
      screen.getByText('Follows your system by default. Your choice is saved in this browser.'),
    ).toBeInTheDocument();
  });

  it('starts on System and says what the system is now (CPY-35)', () => {
    systemDark(true);
    renderPage(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(screen.getByText('Matches your system (dark now)')).toBeInTheDocument();
  });

  it('switches and keeps the choice, in one group of cards named Theme (VIS-28)', async () => {
    systemDark(false);
    renderPage(<AppearanceSection />);
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual([
      'system',
      'light',
      'dark',
    ]);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.queryByText(/Matches your system/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveClass('light');
  });

  it('wraps the theme cards to fewer columns when they get narrow (1.4.4)', () => {
    renderPage(<AppearanceSection />);
    expect(screen.getByRole('group', { name: 'Theme' })).toHaveClass(
      'grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]',
    );
  });
});

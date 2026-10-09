import { act, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from './sonner';

describe('Toaster (D-20, A11Y-25)', () => {
  it('sits bottom right, lifted by --toast-lift on desktop and phone alike', async () => {
    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );
    act(() => void toast('Saved'));
    await screen.findByText('Saved');
    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')!;
    expect(toaster).toHaveAttribute('data-y-position', 'bottom');
    expect(toaster).toHaveAttribute('data-x-position', 'right');
    expect(toaster.style.getPropertyValue('--offset-bottom')).toBe(
      'calc(24px + var(--toast-lift, 0px))',
    );
    expect(toaster.style.getPropertyValue('--mobile-offset-bottom')).toBe(
      'calc(16px + env(safe-area-inset-bottom) + var(--toast-lift, 0px))',
    );
  });
});

import { screen, waitFor } from '@testing-library/react';
import { MotionConfig, MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { NumberTicker } from './NumberTicker';

const format = (n: number) => String(Math.round(n));

// what assistive tech can read: everything outside aria-hidden
const readable = (text: string) => screen.getByText(text, { ignore: '[aria-hidden="true"]' });

function visual(container: HTMLElement) {
  const el = container.querySelector('[aria-hidden="true"]');
  if (!el) throw new Error('no visual number');
  return el;
}

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

describe('NumberTicker', () => {
  it('shows the value on first render without counting', () => {
    const { container } = renderWithMotion(<NumberTicker value={42} format={format} />);
    expect(visual(container)).toHaveTextContent('42');
    expect(readable('42')).toHaveClass('sr-only');
  });

  it('lands on the exact new value and exposes only that to screen readers', async () => {
    const { container, rerender } = renderWithMotion(<NumberTicker value={10} format={format} />);
    rerender(<NumberTicker value={2000} format={format} />);
    await waitFor(() => expect(visual(container)).toHaveTextContent('2000'));
    // one readable copy of the number; the counting digits are hidden
    expect(readable('2000')).toHaveClass('sr-only');
    expect(visual(container).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('counts up from the old value when animations run', async () => {
    MotionGlobalConfig.skipAnimations = false;
    const { container, rerender } = renderWithMotion(<NumberTicker value={10} format={format} />);
    rerender(<NumberTicker value={500} format={format} />);
    // the accessible text is already final while the digits start from the old value
    expect(readable('500')).toHaveClass('sr-only');
    expect(visual(container)).toHaveTextContent('10');
    await waitFor(() => expect(visual(container)).toHaveTextContent('500'), { timeout: 2000 });
  });

  it('jumps straight to the new value under reduced motion', () => {
    MotionGlobalConfig.skipAnimations = false;
    const { container, rerender } = renderWithMotion(
      <MotionConfig reducedMotion="always">
        <NumberTicker value={10} format={format} />
      </MotionConfig>,
    );
    rerender(
      <MotionConfig reducedMotion="always">
        <NumberTicker value={500} format={format} />
      </MotionConfig>,
    );
    expect(visual(container)).toHaveTextContent('500');
  });
});

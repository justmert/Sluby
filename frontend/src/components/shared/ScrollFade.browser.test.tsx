import '@/index.css';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollFade } from './ScrollFade';

afterEach(() => cleanup());

function strip(width: number) {
  const view = render(
    <div style={{ width }}>
      <ScrollFade>
        <div className="overflow-x-auto">
          <div style={{ display: 'flex', width: 600, height: 32 }} />
        </div>
      </ScrollFade>
    </div>,
  );
  const fade = view.container.querySelector<HTMLElement>('[data-slot="scroll-fade"]')!;
  return { fade, scroller: fade.firstElementChild as HTMLElement };
}

describe('ScrollFade', () => {
  it('fades the end while there is more to the right, and the start once scrolled', async () => {
    const { fade, scroller } = strip(300);
    await waitFor(() => expect(fade).toHaveAttribute('data-fade-end'));
    expect(fade).not.toHaveAttribute('data-fade-start');
    expect(getComputedStyle(scroller).maskImage).toContain('linear-gradient');

    scroller.scrollLeft = 120;
    await waitFor(() => expect(fade).toHaveAttribute('data-fade-start'));
    expect(fade).toHaveAttribute('data-fade-end');

    scroller.scrollLeft = 300;
    await waitFor(() => expect(fade).not.toHaveAttribute('data-fade-end'));
  });

  it('fades nothing when the strip fits', async () => {
    const { fade } = strip(800);
    await new Promise((r) => setTimeout(r, 50));
    expect(fade).not.toHaveAttribute('data-fade-start');
    expect(fade).not.toHaveAttribute('data-fade-end');
  });
});

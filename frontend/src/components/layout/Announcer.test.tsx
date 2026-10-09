import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { announce } from '@/lib/announce';
import { Announcer } from './Announcer';

const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

describe('Announcer (I-6)', () => {
  it('is one polite region, mounted empty, that reads what pages announce', async () => {
    render(<Announcer />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    act(() => announce('6 videos'));
    await frame();
    expect(region).toHaveTextContent('6 videos');
  });

  it('reads the same sentence again by emptying the region first', async () => {
    render(<Announcer />);
    const region = screen.getByRole('status');
    act(() => announce('Copied'));
    await frame();
    act(() => announce('Copied'));
    expect(region).toBeEmptyDOMElement();
    await frame();
    expect(region).toHaveTextContent('Copied');
  });
});

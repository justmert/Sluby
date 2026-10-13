import '@/index.css';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RatePoint } from '@/hooks/usePlatformMetrics';
import { BytesChart } from './BytesChart';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
interface BrowserContext {
  userEvent: { hover(el: Element): Promise<void>; unhover(el: Element): Promise<void> };
}
const browser = () => import('vitest/browser' as string) as Promise<BrowserContext>;

afterEach(cleanup);

// 14 rates ten seconds apart, one peak in the middle
const rates: RatePoint[] = Array.from({ length: 14 }, (_, i) => ({
  at: Date.parse('2026-10-07T12:00:00.000Z') + i * 10_000,
  bytesPerSecond: (i === 7 ? 42 : 10 + i) * 10_000,
  requestsPerSecond: 1,
}));

describe('BytesChart in a real browser', () => {
  it('draws the peak bar in the accent and turns a hovered bar to it', async () => {
    const { container } = render(<BytesChart rates={rates} />);
    const bars = [...container.querySelectorAll('[data-slot="bytes-chart"] [data-slot="bar"]')];
    expect(bars).toHaveLength(14);
    const peak = bars.find((b) => b.hasAttribute('data-peak'))!;
    const other = bars[0];
    const accent = getComputedStyle(peak).backgroundColor;
    expect(getComputedStyle(other).backgroundColor).not.toBe(accent);
    const { userEvent } = await browser();
    await userEvent.hover(other);
    // the colour eases over 150 ms
    await vi.waitFor(() => expect(getComputedStyle(other).backgroundColor).toBe(accent));
    await userEvent.unhover(other);
  });
});

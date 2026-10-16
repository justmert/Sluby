import '@/index.css';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { KeysCountLoading, KeysRow, QuickstartLoading, ServerRow } from './quickstart-parts';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

// the keys row in a page container of the given width, as the quickstart
// and its route skeleton draw it; the height of each version at every width
async function heights(count: React.ReactNode, widths: number[]) {
  const view = renderPage(
    <div className="@container/page" data-testid="page">
      <dl>
        <ServerRow label="API key">
          <KeysRow count={count} />
        </ServerRow>
      </dl>
    </div>,
  );
  await document.fonts.ready;
  const page = view.getByTestId('page');
  const out: number[] = [];
  for (const width of widths) {
    page.style.width = `${width}px`;
    out.push(view.container.querySelector('dd')!.getBoundingClientRect().height);
  }
  cleanup();
  return out;
}

afterEach(() => cleanup());

describe('quickstart keys row', () => {
  it('keeps its height when the count arrives, at every page width', async () => {
    // from the narrowest phone to past the width where the label moves beside the row
    const widths = Array.from({ length: 121 }, (_, i) => 260 + i * 4);
    const loading = await heights(<KeysCountLoading />, widths);
    for (const count of ['No active keys yet', '12 active keys']) {
      const loaded = await heights(count, widths);
      widths.forEach((w, i) => expect(loaded[i], `${count} at ${w} px`).toBe(loading[i]));
    }
  });
});

describe('quickstart skeleton', () => {
  for (const width of [1440, 390]) {
    it(`draws the four step cards with their numbers in a column at ${width} px`, async () => {
      await (await browser()).page.viewport(width, 900);
      const view = renderPage(
        <div className="@container/page">
          <QuickstartLoading />
        </div>,
      );
      await document.fonts.ready;
      const cards = [...view.container.querySelectorAll('ol > li')] as HTMLElement[];
      expect(cards).toHaveLength(4);
      const boxes = cards.map((c) => c.getBoundingClientRect());
      // one column, each card below the last, none wider than the page
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].bottom);
      for (const b of boxes) expect(b.right).toBeLessThanOrEqual(width);
      // the number circle is 28 px whatever the width
      const circle = cards[0].querySelector('span[aria-hidden="true"]')!.getBoundingClientRect();
      expect([circle.width, circle.height]).toEqual([28, 28]);
    });
  }
});

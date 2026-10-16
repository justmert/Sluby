import '@/index.css';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { KeysCountLoading, KeysRow, ServerRow } from './quickstart-parts';

// the keys row in a page container of the given width, as the quickstart
// and its route skeleton draw it; the height of each version at every width
async function heights(count: React.ReactNode, widths: number[]) {
  const view = renderPage(
    <div className="@container/page" data-testid="page">
      <dl>
        <ServerRow label="API keys">
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

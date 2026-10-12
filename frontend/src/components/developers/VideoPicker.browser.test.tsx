import '@/index.css';
import type { VideoAsset } from '@sluby/sdk';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { VideoPicker } from './VideoPicker';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

const video = { id: 'v1', title: 'Product walkthrough', accessTier: 'public' } as VideoAsset;

async function heightOf(selected: VideoAsset | undefined) {
  const view = renderPage(
    <div style={{ width: 'min(100%, 640px)' }} className="flex flex-col gap-2.5">
      <h2 id="pick">Pick a video</h2>
      <VideoPicker
        labelledBy="pick"
        videos={selected ? [selected] : undefined}
        selected={selected}
        error={null}
        onChange={() => {}}
        onRetry={() => {}}
      />
    </div>,
  );
  await document.fonts.ready;
  const height = (view.container.firstElementChild as HTMLElement).getBoundingClientRect().height;
  cleanup();
  return height;
}

afterEach(() => cleanup());

describe('VideoPicker', () => {
  for (const width of [1200, 390]) {
    it(`loads in the box the picker fills at ${width} px`, async () => {
      await (await browser()).page.viewport(width, 900);
      expect(await heightOf(undefined)).toBe(await heightOf(video));
    });
  }
});

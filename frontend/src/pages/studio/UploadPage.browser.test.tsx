import '@/index.css';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadStore } from '@/lib/studio-upload';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import UploadPage from './UploadPage';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

const video = (name: string) =>
  new File([new Uint8Array(1_000)], name, { type: 'video/mp4', lastModified: 1 });

beforeEach(() => {
  // the limit and the unfinished uploads never answer; the layout does not need them
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  uploadStore.addDrafts([
    video('a_very_long_file_name_for_the_launch_keynote_recording_final_v2.mp4'),
    video('intro.mov'),
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const d of uploadStore.getState().drafts) uploadStore.removeDraft(d.id);
});

async function at(width: number) {
  await (await browser()).page.viewport(width, 900);
  renderPage(
    <WithSession>
      <UploadPage />
    </WithSession>,
    { route: '/studio/videos/upload' },
  );
  await document.fonts.ready;
  return {
    files: screen.getByRole('region', { name: 'Files' }).getBoundingClientRect(),
    details: screen
      .getByRole('region', {
        name: 'a_very_long_file_name_for_the_launch_keynote_recording_final_v2.mp4',
      })
      .getBoundingClientRect(),
  };
}

describe('the upload page layout, in a real browser', () => {
  it('puts the file list and the selected draft side by side on a wide screen', async () => {
    const { files, details } = await at(1200);
    expect(Math.round(files.top)).toBe(Math.round(details.top));
    expect(files.right).toBeLessThanOrEqual(details.left);
  });

  it('stacks them at 360 px without scrolling the page sideways', async () => {
    const { files, details } = await at(360);
    expect(details.top).toBeGreaterThanOrEqual(files.bottom);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    for (const box of [files, details]) expect(box.right).toBeLessThanOrEqual(360);
  });
});

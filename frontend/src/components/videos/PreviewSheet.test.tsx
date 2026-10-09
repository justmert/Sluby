import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import { jsonFetch, renderPage } from '@/test/render';
import { video } from './test-assets';
import { PreviewSheet } from './PreviewSheet';

vi.mock('@sluby/player', () => ({
  SlubyPlayer: ({
    assetId,
    signed,
    title,
  }: {
    assetId: string;
    signed?: boolean;
    title?: string;
  }) => (
    <video
      data-testid="player"
      data-asset={assetId}
      data-signed={String(!!signed)}
      aria-label={title}
    />
  ),
}));

const list = [
  video('a', 'First'),
  video('b', 'Second', { accessTier: 'private' }),
  video('c', 'Third'),
];

function Harness() {
  const [open, setOpen] = useState<VideoAsset | null>(null);
  const i = open ? list.indexOf(open) : -1;
  return (
    <>
      {list.map((v) => (
        <a
          key={v.id}
          href="#x"
          data-video-link={v.id}
          onClick={(e) => (e.preventDefault(), setOpen(v))}
        >
          {v.title}
        </a>
      ))}
      <PreviewSheet
        asset={open}
        onClose={() => setOpen(null)}
        previous={i > 0 ? list[i - 1] : null}
        next={i >= 0 && i < list.length - 1 ? list[i + 1] : null}
        onStep={setOpen}
      />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      jsonFetch({
        '/api/v1/assets/a/playback-ids': { data: [] },
        '/api/v1/assets/b/playback-ids': { data: [] },
        '/api/v1/assets/c/playback-ids': { data: [] },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('PreviewSheet', () => {
  it('names the video after its title, as the video page does (A11Y-20)', async () => {
    renderPage(<Harness />);
    await userEvent.click(screen.getByText('Third'));
    const sheet = await screen.findByRole('dialog', { name: 'Third' });
    expect(within(sheet).getByTestId('player')).toHaveAccessibleName('Third');
  });

  it('plays the video, signs a private one, and links to its page', async () => {
    renderPage(<Harness />);
    await userEvent.click(screen.getByText('Second'));
    const sheet = await screen.findByRole('dialog', { name: 'Second' });
    expect(within(sheet).getByTestId('player')).toHaveAttribute('data-signed', 'true');
    // a private video's embed starts with the server code that signs it
    expect(await within(sheet).findByRole('tab', { name: 'Server' })).toBeInTheDocument();
    expect(within(sheet).getByText('Private')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Open video' })).toHaveAttribute(
      'href',
      '/studio/videos/b',
    );
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Second' })).toHaveAttribute(
      'dir',
      'auto',
    );
  });

  it('steps with the arrow keys and the buttons, and says where it is', async () => {
    renderPage(<Harness />);
    await userEvent.click(screen.getByText('First'));
    await screen.findByRole('dialog', { name: 'First' });
    expect(screen.getByRole('button', { name: 'Previous video' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByText('Previewing “Second”')).toHaveAttribute('role', 'status');
    await userEvent.click(screen.getByRole('button', { name: 'Next video' }));
    expect(await screen.findByRole('dialog', { name: 'Third' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next video' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // focus stayed on the button at the end of the list
    expect(screen.getByRole('button', { name: 'Next video' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'Second' })).toBeInTheDocument();
  });

  it('gives focus back to the title of the video it showed last', async () => {
    renderPage(<Harness />);
    await userEvent.click(screen.getByText('First'));
    await screen.findByRole('dialog', { name: 'First' });
    await userEvent.keyboard('{ArrowRight}');
    await screen.findByRole('dialog', { name: 'Second' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Second')).toHaveFocus();
  });
});

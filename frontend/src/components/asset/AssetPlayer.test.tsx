import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SlubyPlayerProps } from '@sluby/player';
import { ConflictError, SlubyError } from '@sluby/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { AssetPlayer } from './AssetPlayer';

// the real player needs MSE and a stream; its own package tests cover that.
// here it is a stand-in that records its props and lets the test fire events.
const { last, setQuality } = vi.hoisted(() => ({
  last: { props: null as SlubyPlayerProps | null },
  setQuality: vi.fn(),
}));
vi.mock('@sluby/player', async () => {
  const React = await import('react');
  return {
    SlubyPlayer: React.forwardRef<unknown, SlubyPlayerProps>(function FakePlayer(props, ref) {
      last.props = props;
      React.useImperativeHandle(ref, () => ({ setQuality }));
      return React.createElement('video', { 'aria-label': props.title });
    }),
  };
});

const fire = (fn: () => void) => act(fn);
const levels = [
  { index: 0, width: 1920, height: 1080, bitrate: 5_000_000, name: '1080p' },
  { index: 1, width: 1280, height: 720, bitrate: 2_500_000, name: '720p' },
];

beforeEach(() => {
  last.props = null;
  setQuality.mockClear();
});

describe('AssetPlayer', () => {
  it('plays the video through the sdk client, named after its title', () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} title="Product walkthrough" />);
    expect(last.props).toMatchObject({
      assetId: 'a1',
      signed: false,
      title: 'Product walkthrough',
    });
    expect(screen.getByLabelText('Product walkthrough')).toBeInTheDocument();
  });

  it('plays a private video signed, renewing an hour at a time', () => {
    renderPage(<AssetPlayer assetId="a1" signed title="x" />);
    expect(last.props).toMatchObject({ signed: true, expiresIn: 3600 });
  });

  it('offers the qualities with Auto, and says what plays in plain words', async () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} />);
    fire(() => last.props!.onQualitiesChange!(levels));
    fire(() => last.props!.onQualityChange!(levels[1]));
    const group = screen.getByRole('radiogroup', { name: 'Quality' });
    expect(group.className).toContain('flex-wrap');
    expect(
      within(group)
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['Auto', '1080p', '720p']);
    expect(
      screen.getByText('Playing 720p (1280 × 720, 2.5 Mbps), picked automatically'),
    ).toBeInTheDocument();

    await userEvent.click(within(group).getByRole('radio', { name: '1080p' }));
    expect(setQuality).toHaveBeenCalledWith(0);
    fire(() => last.props!.onQualityChange!(levels[0]));
    expect(screen.getByText('Playing 1080p (1920 × 1080, 5 Mbps)')).toBeInTheDocument();
  });

  it('names where the bytes come from', () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} />);
    fire(() => last.props!.onDeliveryChange!('sia'));
    expect(screen.getByText('Streaming from Sia')).toBeInTheDocument();
    fire(() => last.props!.onDeliveryChange!('gateway'));
    expect(screen.getByText('Streaming through this server')).toBeInTheDocument();
  });

  it('announces a playback error with the reader sentence for the api error behind it', () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} />);
    const cause = new ConflictError('Video is not ready for playback (status: processing)');
    fire(() => last.props!.onError!(new Error('Failed to resolve playback URL', { cause })));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not play this video')).toBeInTheDocument();
    expect(
      within(alert).getByText('This video is still processing. It can play once it is ready.'),
    ).toBeInTheDocument();
  });

  it('says Sia could not start playback when the share map fails', () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} />);
    const cause = new SlubyError(
      'The Sia indexer did not answer while minting share URLs; try again',
      502,
    );
    fire(() => last.props!.onError!(new Error('x', { cause })));
    expect(
      within(screen.getByRole('alert')).getByText(
        'Could not start playback from Sia. Try again in a moment.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps a player-only error out of the main line and clears it once playback is ready', async () => {
    renderPage(<AssetPlayer assetId="a1" signed={false} />);
    fire(() => last.props!.onError!(new Error('MediaError code 4: Format error')));
    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByText('Something went wrong. Try again in a moment.'),
    ).toBeInTheDocument();
    fire(() => last.props!.onReady!());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

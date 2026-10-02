import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import AssetDetailPage from './AssetDetailPage';

const setQuality = vi.fn();
const playerProps = vi.fn();

// the real player needs MSE and hls.js; this stand-in drives the same callbacks
vi.mock('@sluby/player', () => ({
  SlubyPlayer: forwardRef(function FakePlayer(props: Record<string, unknown>, ref) {
    playerProps(props);
    useImperativeHandle(ref, () => ({ setQuality }));
    useEffect(() => {
      (props.onQualitiesChange as (l: unknown[]) => void)?.([
        { index: 0, width: 1280, height: 720, bitrate: 3_500_000, name: '720p' },
        { index: 1, width: 640, height: 360, bitrate: 800_000, name: '360p' },
      ]);
      (props.onQualityChange as (l: unknown) => void)?.({
        index: 0,
        width: 1280,
        height: 720,
        bitrate: 3_500_000,
        name: '720p',
      });
      (props.onDeliveryChange as (m: string) => void)?.('sia');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <video data-testid="player" />;
  }),
}));

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Big Buck Bunny',
  description: 'A bunny',
  manifest_object_id: 'master-1',
  thumbnail_object_ids: [],
  duration_ms: 596_000,
  resolution: '1280x720',
  status: 'ready',
  access_tier: 'private',
  creator_address: 'github:dev',
  segment_count: 2,
  total_storage_bytes: 9_000_000,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

const sia = {
  manifest_object_id: 'master-1',
  objects: [
    {
      object_id: 'master-1',
      role: 'master_manifest',
      rendition: null,
      size: 400,
      encoded_size: 4_194_304,
      slab_count: 1,
      sector_count: 30,
      shared_slab_count: 0,
      host_count: 30,
      created_at: '2026-10-01T00:00:00Z',
    },
    {
      object_id: 'pl-720',
      role: 'variant_playlist',
      rendition: '720p',
      size: 300,
      encoded_size: 300,
      slab_count: 1,
      sector_count: 30,
      shared_slab_count: 1,
      host_count: 30,
      created_at: '2026-10-01T00:00:00Z',
    },
  ],
  unavailable_object_ids: [],
  totals: {
    object_count: 2,
    raw_bytes: 700,
    encoded_bytes: 4_194_604,
    unique_slab_count: 2,
    unique_sector_count: 60,
    sector_bytes: 60 * 4 * 1024 * 1024,
    data_shards: 10,
    parity_shards: 20,
    redundancy_ratio: 3,
    host_count: 31,
    country_count: 2,
  },
  hosts: [
    {
      public_key: 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sectors: 2,
      country_code: 'DE',
      latitude: 0,
      longitude: 0,
      good_for_upload: true,
    },
  ],
  countries: [
    { country_code: 'DE', hosts: 20, sectors: 40 },
    { country_code: 'US', hosts: 11, sectors: 20 },
  ],
  contracts: null,
  indexer: { url: 'https://sia.storage', network: 'mainnet', wallet_address: null },
};

const renditions = {
  data: [
    {
      name: '720p',
      width: 1280,
      height: 720,
      video_bitrate_kbps: 3500,
      segment_count: 60,
      byte_size: 8_000_000,
      data_object_id: 'data-720',
      playlist_object_id: 'pl-720',
    },
  ],
};

function render(assetBody = asset()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      jsonFetch({
        '/api/v1/assets/a1': assetBody,
        '/api/v1/assets/a1/sia': sia,
        '/api/v1/assets/a1/renditions': renditions,
        '/api/v1/assets/a1/processing': {
          id: 'j',
          status: 'failed',
          stage: 'failed',
          progress_percent: 65,
          retry_count: 3,
          error_message: 'ffmpeg exited with code 1',
          started_at: null,
          completed_at: null,
          created_at: '2026-10-01T00:00:00Z',
          logs: [{ timestamp: '2026-10-01T00:00:00Z', stage: 'transcode', message: 'Starting' }],
        },
      }),
    ),
  );
  return renderPage(
    <Routes>
      <Route path="/studio/assets/:id" element={<AssetDetailPage />} />
    </Routes>,
    { route: '/studio/assets/a1' },
  );
}

beforeEach(() => {
  setQuality.mockClear();
  playerProps.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('AssetDetailPage', () => {
  it('embeds the player signed for private assets and switches quality', async () => {
    render();
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    expect(playerProps.mock.calls[0][0]).toMatchObject({ assetId: 'a1', signed: true });
    expect(screen.getByText('Streaming direct from Sia')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '360p' }));
    expect(setQuality).toHaveBeenLastCalledWith(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(setQuality).toHaveBeenLastCalledWith(-1);
  });

  it('shows the Sia breakdown with shards, redundancy and countries', async () => {
    render();
    expect(await screen.findByText('3.0x')).toBeInTheDocument();
    expect(screen.getByText('10 data + 20 parity shards')).toBeInTheDocument();
    // once in the host list, once in the country bars
    expect(screen.getAllByText('Germany')).toHaveLength(2);
    expect(screen.getByText('20 sectors, 11 hosts')).toBeInTheDocument();
    expect(screen.getByText('1 shared')).toBeInTheDocument();
    expect(screen.getByText('Variant playlist')).toBeInTheDocument();
  });

  it('lists the real renditions', async () => {
    render();
    await screen.findByTestId('player');
    await userEvent.click(screen.getByRole('tab', { name: 'Renditions' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('1280x720')).toBeInTheDocument();
    expect(within(table).getByText('3.5 Mbps')).toBeInTheDocument();
  });

  it('shows the pipeline error and a retry for failed assets', async () => {
    render(asset({ status: 'failed', manifest_object_id: null }));
    expect(await screen.findByText('ffmpeg exited with code 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });
});

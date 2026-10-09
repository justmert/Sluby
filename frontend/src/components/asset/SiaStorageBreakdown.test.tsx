import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderPage } from '@/test/render';
import type { SiaStorageInfo } from '@/hooks/asset-detail-queries';
import { SiaStorageBreakdown } from './SiaStorageBreakdown';

const MiB = 1024 * 1024;

function info(overrides: Partial<SiaStorageInfo['totals']> = {}): SiaStorageInfo {
  return {
    manifest_object_id: 'm',
    objects: [],
    unavailable_object_ids: [],
    totals: {
      object_count: 3,
      raw_bytes: 4_100_000,
      encoded_bytes: 90 * 4 * MiB,
      unique_slab_count: 3,
      unique_sector_count: 90,
      sector_bytes: 90 * 4 * MiB,
      data_shards: 10,
      parity_shards: 20,
      redundancy_ratio: 3,
      host_count: 1,
      country_count: 1,
      ...overrides,
    },
    hosts: [
      {
        public_key: 'ed25519:0123456789abcdef0123456789abcdef',
        sectors: 1,
        country_code: 'DE',
        latitude: null,
        longitude: null,
        good_for_upload: true,
      },
    ],
    countries: [{ country_code: 'DE', hosts: 1, sectors: 1 }],
    contracts: null,
    indexer: { url: 'https://sia.storage', network: 'mainnet', wallet_address: null },
  };
}

const show = (i: SiaStorageInfo) =>
  renderPage(<SiaStorageBreakdown info={i} isLoading={false} error={null} />);

describe('SiaStorageBreakdown', () => {
  it('uses singular counts', () => {
    show(info());
    expect(screen.getByText('1 sector, 1 host')).toBeInTheDocument();
    expect(screen.getByText('1 sector')).toBeInTheDocument();
  });

  it('says how much of the encoded size is slab padding', () => {
    show(info());
    // 3 slabs of 10 x 4 MiB hold 125.8 MB, 4.1 MB of it data, times 3 for redundancy
    expect(screen.getByText('With redundancy and 365 MB of padding')).toBeInTheDocument();
  });

  it('tells "no data" apart from mixed shard configs', () => {
    const none = show(
      info({
        unique_slab_count: 0,
        data_shards: null,
        parity_shards: null,
        redundancy_ratio: null,
      }),
    );
    expect(screen.getByText('No slab was described')).toBeInTheDocument();
    expect(screen.queryByText('Mixed')).not.toBeInTheDocument();
    none.unmount();

    show(info({ data_shards: null, parity_shards: null, redundancy_ratio: null }));
    expect(screen.getByText('Mixed')).toBeInTheDocument();
    expect(screen.getByText('Slabs use different shard counts')).toBeInTheDocument();
  });

  it('shortens host keys with the same ellipsis as object ids', () => {
    show(info());
    expect(screen.getByText('01234567…89abcdef')).toBeInTheDocument();
  });

  it('opens with one plain sentence built from the numbers (copy P2)', () => {
    show(info({ object_count: 9, host_count: 30, country_count: 6, redundancy_ratio: 3 }));
    expect(
      screen.getByText(
        'This video is stored as 9 files on 30 hosts in 6 countries. Sia keeps 3× the data, so the video stays playable if some hosts go offline.',
      ),
    ).toBeInTheDocument();
  });

  it('explains the Sia terms with the shard counts from the API', async () => {
    show(info({ data_shards: 10, parity_shards: 20 }));
    await userEvent.click(screen.getByRole('button', { name: 'What do these numbers mean?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Any 10 of its 30 shards rebuild it/)).toBeInTheDocument();
    for (const term of ['Slab', 'Shard', 'Sector', 'Padding', 'File contract']) {
      expect(within(dialog).getByText(term)).toBeInTheDocument();
    }
  });

  it('writes figures in the figure style, units in decimal and the ratio with a times sign', () => {
    show(info({ unique_sector_count: 12_345 }));
    expect(screen.getByText('3×').className).toContain('text-figure-sm');
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('About 4.2 MB each, on one host')).toBeInTheDocument();
    expect(screen.queryByText(/MiB/)).toBeNull();
  });

  it('names hosts with no location Unknown, and says why', () => {
    const i = info();
    i.hosts[0].country_code = null;
    show(i);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(
      screen.getByText(/means the Sia indexer did not report the host's location\./),
    ).toBeInTheDocument();
  });

  it('keeps partial totals and says which part is missing', () => {
    show({ ...info(), unavailable_object_ids: ['x'] });
    expect(screen.getByText('The Sia indexer did not describe 1 of 3 objects')).toBeInTheDocument();
    expect(screen.getByText('3×')).toBeInTheDocument();
  });

  it('shows a load error with Try again and no raw text on the main line', async () => {
    const onRetry = vi.fn();
    renderPage(
      <SiaStorageBreakdown
        isLoading={false}
        error={new ApiError(502, 'The Sia indexer did not answer: ECONNRESET')}
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not load Sia storage details')).toBeInTheDocument();
    expect(
      within(alert).getByText(/The server ran into a problem \(error 502\)/),
    ).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says it is loading without jargon', () => {
    renderPage(<SiaStorageBreakdown isLoading error={null} />);
    expect(screen.getByText('Loading storage details…')).toBeInTheDocument();
  });
});

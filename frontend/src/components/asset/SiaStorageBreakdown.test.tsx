import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  render(<SiaStorageBreakdown info={i} isLoading={false} error={null} />);

describe('SiaStorageBreakdown', () => {
  it('uses singular counts', () => {
    show(info());
    expect(screen.getByText('1 sector, 1 host')).toBeInTheDocument();
    expect(screen.getByText('1 sector')).toBeInTheDocument();
  });

  it('says how much of the encoded size is slab padding', () => {
    show(info());
    // 3 slabs of 10 x 4 MiB hold 125.8 MB, 4.1 MB of it data, times 3 for redundancy
    expect(
      screen.getByText(
        'After erasure coding. Slabs are filled to a fixed size, so 365 MB of this is padding.',
      ),
    ).toBeInTheDocument();
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
    expect(screen.queryByText('mixed')).not.toBeInTheDocument();
    none.unmount();

    show(info({ data_shards: null, parity_shards: null, redundancy_ratio: null }));
    expect(screen.getByText('mixed')).toBeInTheDocument();
    expect(screen.getByText('Slabs use different shard configs')).toBeInTheDocument();
  });

  it('shortens host keys with the same ellipsis as object ids', () => {
    show(info());
    expect(screen.getByText('01234567…89abcdef')).toBeInTheDocument();
  });
});

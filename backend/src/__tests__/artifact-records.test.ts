import { describe, it, expect } from 'vitest';
import {
  buildStorageRecords,
  resolveArtifactRows,
  type VariantUpload,
  type ThumbnailUpload,
  type MasterUpload,
  type ArtifactRecord,
} from '../storage/artifact-records.js';

const variants: VariantUpload[] = [
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 6000,
    segmentCount: 12,
    dataObjectId: 'data-1080',
    dataByteSize: 5_000_000,
    playlistObjectId: 'pl-1080',
    playlistByteSize: 800,
  },
  {
    name: '360p',
    width: 640,
    height: 360,
    videoBitrateKbps: 800,
    segmentCount: 12,
    dataObjectId: 'data-360',
    dataByteSize: 900_000,
    playlistObjectId: 'pl-360',
    playlistByteSize: 780,
  },
];

const thumbnails: ThumbnailUpload[] = [
  { objectId: 'thumb-1', byteSize: 10_000 },
  { objectId: 'thumb-2', byteSize: 11_000 },
  { objectId: 'thumb-3', byteSize: 12_000 },
];

const master: MasterUpload = { objectId: 'master-1', byteSize: 500 };

describe('buildStorageRecords', () => {
  it('produces one rendition record per variant with its metadata and object ids', () => {
    const { renditions } = buildStorageRecords({ variants, thumbnails, master });

    expect(renditions).toHaveLength(2);
    expect(renditions[0]).toEqual({
      name: '1080p',
      width: 1920,
      height: 1080,
      videoBitrateKbps: 6000,
      segmentCount: 12,
      byteSize: 5_000_000,
      dataObjectId: 'data-1080',
      playlistObjectId: 'pl-1080',
    });
    expect(renditions[1].name).toBe('360p');
    expect(renditions[1].byteSize).toBe(900_000);
  });

  it('maps every uploaded object to exactly one artifact with the correct role and rendition link', () => {
    const { artifacts } = buildStorageRecords({ variants, thumbnails, master });

    // 1 master + (data + playlist) per variant + 1 per thumbnail = 1 + 4 + 3 = 8
    expect(artifacts).toHaveLength(8);

    const byId = new Map(artifacts.map((a) => [a.objectId, a]));

    // Master: asset-level, no rendition.
    expect(byId.get('master-1')).toEqual({
      role: 'master_manifest',
      objectId: 'master-1',
      byteSize: 500,
      renditionName: null,
    });

    // Rendition data + playlist link back to their rendition by name.
    expect(byId.get('data-1080')).toMatchObject({ role: 'rendition_data', renditionName: '1080p', byteSize: 5_000_000 });
    expect(byId.get('pl-1080')).toMatchObject({ role: 'variant_playlist', renditionName: '1080p' });
    expect(byId.get('data-360')).toMatchObject({ role: 'rendition_data', renditionName: '360p' });
    expect(byId.get('pl-360')).toMatchObject({ role: 'variant_playlist', renditionName: '360p' });

    // Thumbnails: asset-level, no rendition.
    expect(byId.get('thumb-2')).toMatchObject({ role: 'thumbnail', renditionName: null });
  });

  it('covers every object id exactly once (no orphans, no duplicates)', () => {
    const { artifacts } = buildStorageRecords({ variants, thumbnails, master });

    const ids = artifacts.map((a) => a.objectId);
    const expected = [
      'master-1',
      'data-1080', 'pl-1080',
      'data-360', 'pl-360',
      'thumb-1', 'thumb-2', 'thumb-3',
    ];
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids.sort()).toEqual(expected.sort()); // exact coverage
  });
});

describe('resolveArtifactRows', () => {
  const inserted = [
    { id: 'rend-uuid-1080', name: '1080p' },
    { id: 'rend-uuid-360', name: '360p' },
  ];

  const artifacts: ArtifactRecord[] = [
    { role: 'master_manifest', objectId: 'master-1', byteSize: 500, renditionName: null },
    { role: 'rendition_data', objectId: 'data-1080', byteSize: 5_000_000, renditionName: '1080p' },
    { role: 'variant_playlist', objectId: 'pl-360', byteSize: 780, renditionName: '360p' },
    { role: 'thumbnail', objectId: 'thumb-1', byteSize: 10_000, renditionName: null },
  ];

  it('resolves each rendition name to its inserted rendition id, null for asset-level artifacts', () => {
    const rows = resolveArtifactRows('asset-1', inserted, artifacts);

    expect(rows).toEqual([
      { videoAssetId: 'asset-1', renditionId: null, role: 'master_manifest', objectId: 'master-1', byteSize: 500 },
      { videoAssetId: 'asset-1', renditionId: 'rend-uuid-1080', role: 'rendition_data', objectId: 'data-1080', byteSize: 5_000_000 },
      { videoAssetId: 'asset-1', renditionId: 'rend-uuid-360', role: 'variant_playlist', objectId: 'pl-360', byteSize: 780 },
      { videoAssetId: 'asset-1', renditionId: null, role: 'thumbnail', objectId: 'thumb-1', byteSize: 10_000 },
    ]);
  });

  it('throws if an artifact names a rendition that was not inserted (surfaces a mapping bug)', () => {
    const bad: ArtifactRecord[] = [
      { role: 'rendition_data', objectId: 'data-x', byteSize: 1, renditionName: '2160p' },
    ];
    expect(() => resolveArtifactRows('asset-1', inserted, bad)).toThrow(/2160p/);
  });
});

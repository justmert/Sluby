import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../storage/sia-client.js', () => ({
  uploadAndPin: vi.fn(),
  uploadAndPinPacked: vi.fn(),
  deleteObject: vi.fn(),
}));

import { uploadSegments } from '../storage/segment-uploader.js';
import { uploadAndPin, uploadAndPinPacked, deleteObject } from '../storage/sia-client.js';
import type { PackedSource } from '../storage/sia-client.js';

const mockedPin = vi.mocked(uploadAndPin);
const mockedPacked = vi.mocked(uploadAndPinPacked);
const mockedDelete = vi.mocked(deleteObject);

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
  '720p/playlist.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
  '360p/playlist.m3u8',
  '',
].join('\n');

const variantPlaylist = (initSize: number, segSize: number) =>
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MAP:URI="data.m4s",BYTERANGE="' + initSize + '@0"',
    '#EXTINF:6.0,',
    '#EXT-X-BYTERANGE:' + segSize + '@' + initSize,
    'data.m4s',
    '#EXTINF:4.0,',
    '#EXT-X-BYTERANGE:' + segSize + '@' + (initSize + segSize),
    'data.m4s',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

let dir: string;
let thumbs: string[];

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(path.join(tmpdir(), 'sluby-segments-'));
  for (const [name, size] of [
    ['720p', 3000],
    ['360p', 1000],
  ] as const) {
    await mkdir(path.join(dir, name));
    await writeFile(path.join(dir, name, 'playlist.m3u8'), variantPlaylist(100, (size - 100) / 2));
    await writeFile(path.join(dir, name, 'data.m4s'), Buffer.alloc(size, 7));
  }
  await writeFile(path.join(dir, 'master.m3u8'), MASTER);
  thumbs = [path.join(dir, 'thumb-0.jpg'), path.join(dir, 'thumb-1.jpg')];
  for (const t of thumbs) await writeFile(t, Buffer.alloc(50, 1));

  // ids name what was uploaded so the assertions below can follow them
  mockedPacked.mockImplementation(async (items: PackedSource[]) =>
    Promise.all(
      items.map(async (item) =>
        item instanceof Uint8Array
          ? { objectId: `bytes-${new TextDecoder().decode(item).length}`, size: item.length }
          : {
              objectId: `file:${path.relative(dir, item.path)}`,
              size: (await stat(item.path)).size,
            },
      ),
    ),
  );
  mockedPin.mockImplementation(async (data: Uint8Array) => ({
    objectId: 'master-obj',
    size: data.length,
  }));
  mockedDelete.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('uploadSegments', () => {
  it('uploads data and thumbnails, then playlists, then the master: three uploads', async () => {
    const progress: Array<[number, number]> = [];
    const result = await uploadSegments(dir, {
      thumbnailPaths: thumbs,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(mockedPacked).toHaveBeenCalledTimes(2);
    expect(mockedPin).toHaveBeenCalledTimes(1);

    // first batch: every variant data file and every thumbnail, read from disk
    expect(mockedPacked.mock.calls[0][0]).toEqual([
      { path: path.join(dir, '720p', 'data.m4s') },
      { path: path.join(dir, '360p', 'data.m4s') },
      { path: thumbs[0] },
      { path: thumbs[1] },
    ]);

    // second batch: the variant playlists, pointing at their data objects
    const playlists = (mockedPacked.mock.calls[1][0] as Uint8Array[]).map((b) =>
      new TextDecoder().decode(b),
    );
    expect(playlists).toHaveLength(2);
    expect(playlists[0]).toContain('/v1/objects/file:720p/data.m4s');
    expect(playlists[0]).not.toMatch(/^data\.m4s$/m);
    expect(playlists[1]).toContain('/v1/objects/file:360p/data.m4s');
    expect(playlists[0]).toContain('#EXT-X-BYTERANGE:1450@100');

    // the master points at the playlist objects
    const master = new TextDecoder().decode(mockedPin.mock.calls[0][0]);
    expect(master).toContain(`/v1/objects/bytes-${playlists[0].length}`);
    expect(master).toContain(`/v1/objects/bytes-${playlists[1].length}`);
    expect(master).toContain('RESOLUTION=1280x720');

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);

    expect(result.masterManifestObjectId).toBe('master-obj');
    expect(result.thumbnailObjectIds).toEqual(['file:thumb-0.jpg', 'file:thumb-1.jpg']);
    expect(result.totalSegments).toBe(2);
    expect(result.allObjectIds).toHaveLength(7);
    expect(result.totalBytes).toBe(
      3000 + 1000 + 50 + 50 + playlists[0].length + playlists[1].length + master.length,
    );

    const renditions = result.storageRecords.renditions;
    expect(renditions.map((r) => [r.name, r.width, r.height, r.videoBitrateKbps])).toEqual([
      ['720p', 1280, 720, 2800],
      ['360p', 640, 360, 800],
    ]);
  });

  it('retries the data batch, then fails the job with the last error', async () => {
    // only the backoff sleeps are faked; the file reads stay real
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockedPacked.mockRejectedValue(new Error('no more hosts available'));
      let settled = false;
      const run = uploadSegments(dir, { thumbnailPaths: thumbs });
      const assertion = expect(run).rejects.toThrow(
        'variant data upload failed after 5 attempts: no more hosts available',
      );
      run.catch(() => {}).finally(() => (settled = true));
      while (!settled) {
        await new Promise((r) => setImmediate(r));
        await vi.advanceTimersByTimeAsync(60_000);
      }
      await assertion;
      expect(mockedPacked).toHaveBeenCalledTimes(5);
      expect(mockedPin).not.toHaveBeenCalled();
      // nothing was pinned, so there is nothing to clean up
      expect(mockedDelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unpins everything already pinned when a later upload fails', async () => {
    mockedPin.mockRejectedValue(new Error('indexer unavailable'));
    await expect(uploadSegments(dir, { thumbnailPaths: thumbs })).rejects.toThrow(
      'indexer unavailable',
    );
    // four data/thumbnail objects and two playlists were pinned before the master failed
    expect(mockedDelete).toHaveBeenCalledTimes(6);
    expect(mockedDelete).toHaveBeenCalledWith('file:720p/data.m4s');
    expect(mockedDelete).toHaveBeenCalledWith('file:thumb-1.jpg');
  });

  it('rejects output that was not transcoded in single file mode', async () => {
    await writeFile(path.join(dir, '360p', 'playlist.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
    await expect(uploadSegments(dir, {})).rejects.toThrow(
      'variant 360p/playlist.m3u8 has no data file reference',
    );
    expect(mockedPacked).not.toHaveBeenCalled();
  });
});

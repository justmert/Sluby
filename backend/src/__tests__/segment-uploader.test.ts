import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fake = await vi.hoisted(async () => (await import('./helpers/fake-sia.js')).createFakeSia());
vi.mock('@siafoundation/sia-storage', () => fake.module);
// the prune gate's leases live in memory here; slab-prune-gate.redis.test.ts covers the redis ones
vi.mock('../storage/prune-leases.js', async () => {
  const { MemoryPruneLeases } = await import('./helpers/memory-prune-leases.js');
  return {
    RedisPruneLeases: class extends MemoryPruneLeases {
      constructor() {
        super();
      }
    },
  };
});

import { uploadSegments } from '../storage/segment-uploader.js';
import { deleteObject } from '../storage/sia-client.js';
import type { ObjectLedger } from '../storage/object-ledger.js';

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

/**
 * The ledger the pipeline keeps in pending_objects, in memory: ids are
 * recorded before their pin, and released ones are unpinned through the real
 * sia client.
 */
function memoryLedger() {
  const uploading = new Set<string>();
  const pinnedWhenRecorded: number[] = [];
  const ledger: ObjectLedger = {
    record: async (ids) => {
      pinnedWhenRecorded.push(ids.filter((id) => fake.objects.has(id)).length);
      for (const id of ids) uploading.add(id);
    },
    release: async (ids) => {
      for (const id of ids) {
        await deleteObject(id);
        uploading.delete(id);
      }
    },
  };
  return { ledger, uploading, pinnedWhenRecorded };
}

/** Every pinned object is one the ledger still holds: none is pinned without a record. */
function expectEveryPinnedObjectRecorded(uploading: Set<string>) {
  for (const id of fake.pinnedIds()) expect(uploading.has(id)).toBe(true);
}

const settle = () => new Promise((r) => setTimeout(r, 20));

let dir: string;
let thumbs: string[];

beforeEach(async () => {
  fake.reset();
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
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('uploadSegments', () => {
  it('uploads data and thumbnails, then playlists, then the master: three uploads', async () => {
    const { ledger, uploading, pinnedWhenRecorded } = memoryLedger();
    const progress: Array<[number, number]> = [];
    const result = await uploadSegments(dir, {
      thumbnailPaths: thumbs,
      ledger,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(fake.calls.finalize).toBe(3);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    // recorded before pinned, every batch
    expect(pinnedWhenRecorded).toEqual([0, 0, 0]);
    expect(fake.pinnedIds()).toEqual([...result.allObjectIds].sort());
    expect([...uploading].sort()).toEqual([...result.allObjectIds].sort());

    const [r720, r360] = result.storageRecords.renditions;
    expect([r720, r360].map((r) => [r.name, r.width, r.height, r.videoBitrateKbps])).toEqual([
      ['720p', 1280, 720, 2800],
      ['360p', 640, 360, 800],
    ]);
    expect(fake.objects.get(r720.dataObjectId)!.size).toBe(3000);
    expect(fake.objects.get(r360.dataObjectId)!.size).toBe(1000);
    expect(result.thumbnailObjectIds.map((id) => fake.objects.get(id)!.size)).toEqual([50, 50]);
    expect(result.totalSegments).toBe(2);
    expect(result.allObjectIds).toHaveLength(7);
    expect(result.totalBytes).toBe([...fake.objects.values()].reduce((n, o) => n + o.size, 0));
  });

  it('retries the data batch, then fails with the last error and leaves nothing pinned', async () => {
    // only the backoff sleeps are faked; the file reads stay real
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { ledger, uploading } = memoryLedger();
    try {
      fake.fail('add', new Error('no more hosts available'), 5);
      let settled = false;
      const run = uploadSegments(dir, { thumbnailPaths: thumbs, ledger });
      const assertion = expect(run).rejects.toThrow(
        'variant data upload failed after 5 attempts: no more hosts available',
      );
      run.catch(() => {}).finally(() => (settled = true));
      while (!settled) {
        await new Promise((r) => setImmediate(r));
        await vi.advanceTimersByTimeAsync(60_000);
      }
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(fake.calls.add).toBe(5);
    expect(fake.objects.size).toBe(0);
    expect(uploading.size).toBe(0);
    // the slabs the failed adds stored are pruned
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('releases everything it pinned when a later upload fails', async () => {
    const { ledger, uploading } = memoryLedger();
    // the master's pin: four data and thumbnail objects and two playlists are pinned by then
    fake.before('pinObject', () => {
      if (fake.calls.pinObject === 7) throw new Error('indexer unavailable');
    });
    await expect(uploadSegments(dir, { thumbnailPaths: thumbs, ledger })).rejects.toThrow(
      'indexer unavailable',
    );
    await settle();
    expect(fake.objects.size).toBe(0);
    expect(uploading.size).toBe(0);
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('keeps a record of what it could not unpin', async () => {
    const { ledger, uploading } = memoryLedger();
    const releasing: ObjectLedger = {
      record: ledger.record,
      // the indexer is down for the cleanup too
      release: async () => {},
    };
    fake.before('pinObject', () => {
      if (fake.calls.pinObject === 5) throw new Error('indexer unavailable');
    });
    await expect(
      uploadSegments(dir, { thumbnailPaths: thumbs, ledger: releasing }),
    ).rejects.toThrow('indexer unavailable');
    expect(fake.objects.size).toBeGreaterThan(0);
    expectEveryPinnedObjectRecorded(uploading);
  });

  it('pins nothing of a batch whose ids could not be recorded', async () => {
    const { ledger, uploading } = memoryLedger();
    let records = 0;
    const flaky: ObjectLedger = {
      record: async (ids) => {
        if (++records === 2) throw new Error('db down');
        await ledger.record(ids);
      },
      release: ledger.release,
    };
    await expect(uploadSegments(dir, { thumbnailPaths: thumbs, ledger: flaky })).rejects.toThrow(
      'db down',
    );
    await settle();
    expect(fake.objects.size).toBe(0);
    expect(uploading.size).toBe(0);
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('stops between uploads when the checkpoint says so, releasing what it pinned', async () => {
    const { ledger, uploading } = memoryLedger();
    let checks = 0;
    await expect(
      uploadSegments(dir, {
        thumbnailPaths: thumbs,
        ledger,
        checkpoint: async () => {
          if (++checks === 2) throw new Error('asset deleted');
        },
      }),
    ).rejects.toThrow('asset deleted');
    await settle();
    expect(fake.calls.finalize).toBe(1);
    expect(fake.objects.size).toBe(0);
    expect(uploading.size).toBe(0);
  });

  it('stops before the data batch without retrying and keeps the stop error', async () => {
    const { ledger } = memoryLedger();
    const stop = new Error('asset deleted');
    let checks = 0;
    const run = uploadSegments(dir, {
      thumbnailPaths: thumbs,
      ledger,
      checkpoint: async () => {
        checks += 1;
        throw stop;
      },
    });
    // the pipeline tells a stop from a failure by the error's class
    await expect(run).rejects.toBe(stop);
    expect(checks).toBe(1);
    expect(fake.calls.add).toBe(0);
  });

  it('stops when the asset goes away while the data batch waits to retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { ledger, uploading } = memoryLedger();
    const stop = new Error('asset deleted');
    let checks = 0;
    try {
      fake.fail('add', new Error('no more hosts available'), 1);
      let settled = false;
      const run = uploadSegments(dir, {
        thumbnailPaths: thumbs,
        ledger,
        checkpoint: async () => {
          if (++checks === 2) throw stop;
        },
      });
      const assertion = expect(run).rejects.toBe(stop);
      run.catch(() => {}).finally(() => (settled = true));
      while (!settled) {
        await new Promise((r) => setImmediate(r));
        await vi.advanceTimersByTimeAsync(60_000);
      }
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(checks).toBe(2);
    expect(fake.calls.add).toBe(1);
    expect(fake.objects.size).toBe(0);
    expect(uploading.size).toBe(0);
  });

  it.each([
    [
      'a master without variants, as FFmpeg leaves it after a failure',
      async () => writeFile(path.join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:7\n'),
      'lists no variant playlists',
    ],
    [
      'a variant cut off before its end tag',
      async () =>
        writeFile(
          path.join(dir, '360p', 'playlist.m3u8'),
          variantPlaylist(100, 450).replace('#EXT-X-ENDLIST\n', ''),
        ),
      'variant 360p/playlist.m3u8 is not finished',
    ],
    [
      'a variant without segments',
      async () =>
        writeFile(
          path.join(dir, '360p', 'playlist.m3u8'),
          '#EXTM3U\n#EXT-X-MAP:URI="data.m4s",BYTERANGE="100@0"\n#EXT-X-ENDLIST\n',
        ),
      'variant 360p/playlist.m3u8 has no segments',
    ],
    [
      'output that was not transcoded in single file mode',
      async () => writeFile(path.join(dir, '360p', 'playlist.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n'),
      'variant 360p/playlist.m3u8 has no data file reference',
    ],
    [
      'an empty data file',
      async () => writeFile(path.join(dir, '720p', 'data.m4s'), ''),
      'data.m4s is empty',
    ],
  ])('refuses %s before uploading anything', async (_label, damage, message) => {
    await damage();
    const { ledger } = memoryLedger();
    await expect(uploadSegments(dir, { thumbnailPaths: thumbs, ledger })).rejects.toThrow(message);
    expect(fake.calls.add).toBe(0);
  });
});

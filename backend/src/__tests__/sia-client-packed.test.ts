import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fake = await vi.hoisted(async () => (await import('./helpers/fake-sia.js')).createFakeSia());
vi.mock('@siafoundation/sia-storage', () => fake.module);

import {
  uploadAndPinPacked,
  deleteObject,
  pruneSlabs,
  isIndexerNotFound,
} from '../storage/sia-client.js';

const dir = mkdtempSync(path.join(tmpdir(), 'sluby-packed-'));
const file = (name: string, size: number) => {
  const p = path.join(dir, name);
  writeFileSync(p, Buffer.alloc(size, 1));
  return { path: p };
};

/** Let queued promise callbacks (a deferred prune) run. */
const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  fake.reset();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('uploadAndPinPacked', () => {
  it('uploads files and bytes in order and pins one object each', async () => {
    const results = await uploadAndPinPacked([
      file('data.m4s', 30),
      new Uint8Array(5),
      file('thumb.jpg', 7),
    ]);
    expect(results.map((r) => r.size)).toEqual([30, 5, 7]);
    expect(fake.pinnedIds()).toEqual(results.map((r) => r.objectId).sort());
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('hands the ids to beforePin before any of them is pinned', async () => {
    let pinnedWhenRecorded = -1;
    const recorded: string[] = [];
    const results = await uploadAndPinPacked([new Uint8Array(1), new Uint8Array(2)], {
      beforePin: async (ids) => {
        pinnedWhenRecorded = fake.objects.size;
        recorded.push(...ids);
      },
    });
    expect(pinnedWhenRecorded).toBe(0);
    expect(recorded).toEqual(results.map((r) => r.objectId));
  });

  it('pins nothing when beforePin fails, and prunes the stored slabs', async () => {
    await expect(
      uploadAndPinPacked([new Uint8Array(1)], {
        beforePin: async () => {
          throw new Error('db down');
        },
      }),
    ).rejects.toThrow('db down');
    await settle();
    expect(fake.calls.pinObject).toBe(0);
    expect(fake.objects.size).toBe(0);
    expect(fake.calls.pruneSlabs).toBe(1);
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('unpins the objects that did pin when another pin fails', async () => {
    fake.before('pinObject', () => {
      if (fake.calls.pinObject === 2) throw new Error('pin rejected');
    });
    await expect(
      uploadAndPinPacked([new Uint8Array(1), new Uint8Array(2), new Uint8Array(3)]),
    ).rejects.toThrow('pin rejected');
    await settle();
    expect(fake.objects.size).toBe(0);
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('prunes the slabs a failed add left pinned', async () => {
    fake.fail('add', new Error('host went away'));
    await expect(uploadAndPinPacked([new Uint8Array(1), new Uint8Array(2)])).rejects.toThrow(
      'host went away',
    );
    await settle();
    expect(fake.calls.pruneSlabs).toBe(1);
    expect(fake.slabs.size).toBe(0);
  });

  it('cancels an upload that stores nothing for the stall timeout', async () => {
    fake.hang('finalize');
    await expect(uploadAndPinPacked([new Uint8Array(1)], { stallTimeoutMs: 50 })).rejects.toThrow(
      'Sia upload stored nothing for 0s and was cancelled',
    );
    await settle();
    expect(fake.calls.pinObject).toBe(0);
    expect(fake.orphanSlabs()).toEqual([]);
  });

  it('does nothing for an empty batch', async () => {
    expect(await uploadAndPinPacked([])).toEqual([]);
    expect(fake.calls.add).toBe(0);
  });
});

describe('deleteObject', () => {
  it('unpins a pinned object', async () => {
    const [{ objectId }] = await uploadAndPinPacked([new Uint8Array(1)]);
    await expect(deleteObject(objectId)).resolves.toBe('unpinned');
    expect(fake.objects.size).toBe(0);
  });

  it('counts an object the indexer does not have as done', async () => {
    await expect(deleteObject('ab'.repeat(32))).resolves.toBe('not-found');
  });

  it('throws every other error', async () => {
    fake.fail('deleteObject', new Error('app error: Api(500, "db error")'));
    await expect(deleteObject('ab'.repeat(32))).rejects.toThrow('Api(500');
  });

  it('reads the status, not the body text', () => {
    expect(isIndexerNotFound(new Error('app error: Api(404, "gone")'))).toBe(true);
    expect(isIndexerNotFound(new Error('app error: Api(500, "object not found")'))).toBe(false);
    expect(isIndexerNotFound(new Error('app error: Api(4040, "")'))).toBe(false);
  });
});

describe('pruneSlabs', () => {
  it('waits for an upload in flight, so its slabs are not pruned under it', async () => {
    let release: () => void = () => {};
    fake.before('finalize', () => new Promise<void>((r) => (release = r)));
    const upload = uploadAndPinPacked([new Uint8Array(1), new Uint8Array(2)]);
    await settle();
    expect(fake.inFlightSlabs.size).toBe(2);

    await expect(pruneSlabs()).resolves.toBe('deferred');
    expect(fake.calls.pruneSlabs).toBe(0);

    release();
    await upload;
    await settle();
    expect(fake.calls.pruneSlabs).toBe(1);
    expect(fake.prunedInFlight).toEqual([]);
    expect(fake.objects.size).toBe(2);
  });

  it('holds new uploads while a prune runs', async () => {
    let release: () => void = () => {};
    fake.before('pruneSlabs', () => new Promise<void>((r) => (release = r)));
    const prune = pruneSlabs();
    await settle();
    const upload = uploadAndPinPacked([new Uint8Array(1)]);
    await settle();
    expect(fake.calls.add).toBe(0);
    release();
    await expect(prune).resolves.toBe('pruned');
    await upload;
    expect(fake.calls.add).toBe(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COMPLETION_MARKER,
  assetOutputDir,
  createRunDir,
  findCompletedOutput,
  readCompletionMarker,
  removeAssetOutput,
  sweepOutputDirs,
  writeCompletionMarker,
} from '../queue/output-dirs.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sluby-output-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('run directories', () => {
  it('gives every execution a fresh directory under the asset', async () => {
    const one = await createRunDir(root, A);
    const two = await createRunDir(root, A);
    expect(one).not.toBe(two);
    expect(path.dirname(one)).toBe(path.join(root, A));
  });

  it('refuses a name that is not an asset id, since it is removed recursively', () => {
    expect(() => assetOutputDir(root, '../etc')).toThrow('not an asset id');
  });
});

describe('completion marker', () => {
  it('only a run with the marker counts as finished, the newest one wins', async () => {
    expect(await findCompletedOutput(root, A)).toBeNull();

    const unfinished = await createRunDir(root, A);
    writeFileSync(path.join(unfinished, 'master.m3u8'), '#EXTM3U\n');
    expect(await findCompletedOutput(root, A)).toBeNull();

    const older = await createRunDir(root, A);
    await writeCompletionMarker(older, { durationMs: 1, resolution: '1x1', thumbnails: [] });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await createRunDir(root, A);
    writeFileSync(path.join(newer, 'thumb_25.jpg'), 'jpg');
    await writeCompletionMarker(newer, {
      durationMs: 4000,
      resolution: '640x360',
      thumbnails: ['thumb_25.jpg', 'thumb_50.jpg'],
    });

    const found = await findCompletedOutput(root, A);
    expect(found?.outputDir).toBe(newer);
    expect(found?.marker).toMatchObject({ durationMs: 4000, resolution: '640x360' });
    // only the thumbnails still on disk
    expect(found?.thumbnailPaths).toEqual([path.join(newer, 'thumb_25.jpg')]);
  });

  it('ignores a marker that does not parse into the expected shape', async () => {
    const dir = await createRunDir(root, A);
    writeFileSync(path.join(dir, COMPLETION_MARKER), JSON.stringify({ durationMs: 'x' }));
    expect(await readCompletionMarker(dir)).toBeNull();
    writeFileSync(
      path.join(dir, COMPLETION_MARKER),
      JSON.stringify({
        durationMs: 1,
        resolution: '1x1',
        thumbnails: ['../../escape.jpg'],
        completedAt: 'now',
      }),
    );
    expect(await readCompletionMarker(dir)).toBeNull();
  });
});

describe('sweepOutputDirs', () => {
  it('removes what the asset no longer needs and leaves other entries alone', async () => {
    await createRunDir(root, A);
    await createRunDir(root, B);
    mkdirSync(path.join(root, 'lost+found'));
    const log = { info: vi.fn(), error: vi.fn() };

    const removed = await sweepOutputDirs({
      root,
      dispositions: async (ids) =>
        new Map(ids.map((id) => [id, id === A ? ('remove' as const) : ('keep' as const)])),
      log,
    });

    expect(removed).toBe(1);
    expect(existsSync(path.join(root, A))).toBe(false);
    expect(existsSync(path.join(root, B))).toBe(true);
    expect(existsSync(path.join(root, 'lost+found'))).toBe(true);
  });

  it('is fine with no output directory at all', async () => {
    await removeAssetOutput(root, A);
    const log = { info: vi.fn(), error: vi.fn() };
    expect(
      await sweepOutputDirs({
        root: path.join(root, 'none'),
        dispositions: async () => new Map(),
        log,
      }),
    ).toBe(0);
  });
});

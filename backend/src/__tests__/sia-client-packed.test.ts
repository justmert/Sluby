import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdk = vi.hoisted(() => ({
  uploadPacked: vi.fn(),
  pinObject: vi.fn(),
  deleteObject: vi.fn(),
  account: vi.fn(),
}));

vi.mock('@siafoundation/sia-storage', () => ({
  initSia: vi.fn(async () => {}),
  setLogger: vi.fn(),
  AppKey: class {},
  Builder: class {
    connected = async () => sdk;
  },
}));

import { uploadAndPinPacked } from '../storage/sia-client.js';

const object = (id: string, size: number) => ({ id: () => id, size: () => BigInt(size) });

let added: string[];

beforeEach(() => {
  vi.clearAllMocks();
  added = [];
  sdk.account.mockResolvedValue({ accountKey: 'k', ready: true, remainingStorage: 0n });
  sdk.uploadPacked.mockImplementation(() => ({
    add: vi.fn(async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      let n = 0;
      for (let r = await reader.read(); !r.done; r = await reader.read()) n += r.value.length;
      added.push(`bytes:${n}`);
      return BigInt(n);
    }),
    addPath: vi.fn(async (p: string) => {
      added.push(`path:${p}`);
      return 0n;
    }),
    finalize: vi.fn(async () => added.map((a, i) => object(`obj-${i}`, 10 + i))),
  }));
  sdk.pinObject.mockResolvedValue(undefined);
  sdk.deleteObject.mockResolvedValue(undefined);
});

describe('uploadAndPinPacked', () => {
  it('streams bytes, hands files to the sdk by path, and keeps the order', async () => {
    const results = await uploadAndPinPacked([
      { path: '/out/720p/data.m4s' },
      new Uint8Array(5),
      { path: '/out/thumb.jpg' },
    ]);
    expect(added).toEqual(['path:/out/720p/data.m4s', 'bytes:5', 'path:/out/thumb.jpg']);
    expect(results).toEqual([
      { objectId: 'obj-0', size: 10 },
      { objectId: 'obj-1', size: 11 },
      { objectId: 'obj-2', size: 12 },
    ]);
    expect(sdk.pinObject).toHaveBeenCalledTimes(3);
    expect(sdk.deleteObject).not.toHaveBeenCalled();
  });

  it('unpins the objects that did pin when another pin fails', async () => {
    sdk.pinObject.mockImplementation(async (obj: { id(): string }) => {
      if (obj.id() === 'obj-1') throw new Error('pin rejected');
    });
    await expect(
      uploadAndPinPacked([new Uint8Array(1), new Uint8Array(2), new Uint8Array(3)]),
    ).rejects.toThrow('pin rejected');
    expect(sdk.deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(['obj-0', 'obj-2']);
  });

  it('does nothing for an empty batch', async () => {
    expect(await uploadAndPinPacked([])).toEqual([]);
    expect(sdk.uploadPacked).not.toHaveBeenCalled();
  });
});

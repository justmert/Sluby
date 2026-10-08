import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdk = vi.hoisted(() => ({
  object: vi.fn(),
  download: vi.fn(),
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

import { openObject, readExactly, isIndexerNotFound } from '../storage/sia-client.js';

const BYTES = new Uint8Array(Array.from({ length: 10 }, (_, i) => i));

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.account.mockResolvedValue({ accountKey: 'k', ready: true, remainingStorage: 0n });
  sdk.object.mockResolvedValue({ size: () => BigInt(BYTES.length) });
  sdk.download.mockImplementation((_obj: unknown, opts: { offset?: bigint; length?: bigint }) => {
    const start = Number(opts.offset ?? 0n);
    const end = opts.length === undefined ? BYTES.length : start + Number(opts.length);
    return streamOf(BYTES.slice(start, end));
  });
});

describe('openObject', () => {
  it('asks the indexer once and streams through the handle, with a bounded read-ahead', async () => {
    const handle = await openObject('obj');
    expect(handle.size).toBe(10);

    await readExactly(handle.read({ offset: 2, length: 3 }), 3);
    await readExactly(handle.read(), 10);

    expect(sdk.object).toHaveBeenCalledTimes(1);
    expect(sdk.download).toHaveBeenNthCalledWith(1, expect.anything(), {
      maxBufferedChunks: 4,
      offset: 2n,
      length: 3n,
    });
    expect(sdk.download).toHaveBeenNthCalledWith(2, expect.anything(), { maxBufferedChunks: 4 });
  });
});

describe('readExactly', () => {
  it('reads a window into a buffer of exactly its length', async () => {
    const handle = await openObject('obj');
    expect([...(await readExactly(handle.read({ offset: 4, length: 3 }), 3))]).toEqual([4, 5, 6]);
    expect([...(await readExactly(handle.read(), 10))]).toEqual([...BYTES]);
  });

  it('refuses a stream that ends short or runs long', async () => {
    await expect(readExactly(streamOf(BYTES.slice(0, 4)), 5)).rejects.toThrow(/ended at 4 of 5/);
    await expect(readExactly(streamOf(BYTES), 5)).rejects.toThrow(/ran past/);
  });
});

describe('isIndexerNotFound', () => {
  it('reads the status of an indexer api error', () => {
    expect(isIndexerNotFound(new Error('app error: Api(404, "object not found\\n")'))).toBe(true);
    expect(isIndexerNotFound(new Error('app error: Api(500, "boom")'))).toBe(false);
    expect(isIndexerNotFound(new Error('dial tcp: i/o timeout'))).toBe(false);
  });
});

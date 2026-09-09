import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';
import { createSiaLoader } from './SiaLoader.js';
import type { SiaPlaybackSession } from './types.js';

const ASSET_ID = 'asset-1';

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function makeSession(over: Partial<SiaPlaybackSession> = {}): {
  session: SiaPlaybackSession;
  resolveObjectId: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
} {
  const resolveObjectId = vi.fn(async (_assetId: string, objectId: string) => ({
    handle: objectId,
  }));
  const download = vi.fn(() => streamFromBytes(new Uint8Array([1, 2, 3, 4])));
  const session: SiaPlaybackSession = {
    prepare: vi.fn(async () => undefined),
    resolveObjectId,
    download,
    ...over,
  };
  return {
    session,
    resolveObjectId: (over.resolveObjectId as ReturnType<typeof vi.fn>) ?? resolveObjectId,
    download: (over.download as ReturnType<typeof vi.fn>) ?? download,
  };
}

function ctx(over: {
  url?: string;
  responseType?: string;
  type?: string;
  rangeStart?: number;
  rangeEnd?: number;
}): LoaderContext {
  return { url: '', responseType: 'text', type: 'manifest', ...over } as unknown as LoaderContext;
}

const config = { loadPolicy: { maxLoadTimeMs: 0 } } as unknown as LoaderConfiguration;

function callbacks() {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onTimeout = vi.fn();
  const onAbort = vi.fn();
  const cbs = {
    onSuccess,
    onError,
    onTimeout,
    onAbort,
  } as unknown as LoaderCallbacks<LoaderContext>;
  return { cbs, onSuccess, onError, onTimeout, onAbort };
}

function newLoader(session: SiaPlaybackSession): Loader<LoaderContext> {
  const Ctor = createSiaLoader(session, ASSET_ID);
  return new Ctor({} as HlsConfig);
}

describe('SiaLoader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a manifest object id to a decoded string', async () => {
    const manifest = '#EXTM3U\n#EXT-X-VERSION:7\n';
    const { session, resolveObjectId } = makeSession({
      download: vi.fn(() => streamFromBytes(new TextEncoder().encode(manifest))),
    });
    const loader = newLoader(session);
    const { cbs, onSuccess } = callbacks();

    loader.load(
      ctx({ url: 'https://cache.test/v1/objects/master?type=manifest', responseType: 'text' }),
      config,
      cbs,
    );

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(resolveObjectId).toHaveBeenCalledWith(ASSET_ID, 'master');
    const [response] = onSuccess.mock.calls[0];
    expect(response.data).toBe(manifest);
    expect(typeof response.data).toBe('string');
  });

  it('downloads a byte range for a fragment and returns an ArrayBuffer', async () => {
    const { session, resolveObjectId, download } = makeSession();
    const loader = newLoader(session);
    const { cbs, onSuccess } = callbacks();

    loader.load(
      ctx({
        url: 'https://cache.test/v1/objects/data',
        responseType: 'arraybuffer',
        type: 'media-fragment',
        rangeStart: 10,
        rangeEnd: 30, // exclusive -> length 20
      }),
      config,
      cbs,
    );

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(resolveObjectId).toHaveBeenCalledWith(ASSET_ID, 'data');
    expect(download).toHaveBeenCalledWith({ handle: 'data' }, { offset: 10, length: 20 });
    const [response] = onSuccess.mock.calls[0];
    expect(response.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('downloads the whole object when no range is given', async () => {
    const { session, download } = makeSession();
    const loader = newLoader(session);
    const { cbs, onSuccess } = callbacks();

    loader.load(
      ctx({ url: 'https://cache.test/v1/objects/data', responseType: 'text' }),
      config,
      cbs,
    );

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith({ handle: 'data' }, {});
  });

  it('treats hls.js rangeStart:0/rangeEnd:0 as a full download, not a zero-length read', async () => {
    // hls.js emits 0/0 for a non-byterange fragment and means "download it all".
    const { session, download } = makeSession();
    const loader = newLoader(session);
    const { cbs, onSuccess } = callbacks();

    loader.load(
      ctx({
        url: 'https://cache.test/v1/objects/data',
        responseType: 'arraybuffer',
        type: 'media-fragment',
        rangeStart: 0,
        rangeEnd: 0,
      }),
      config,
      cbs,
    );

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith({ handle: 'data' }, {});
  });

  it('errors when the URL is not an object URL', () => {
    const { session } = makeSession();
    const loader = newLoader(session);
    const { cbs, onError } = callbacks();

    loader.load(ctx({ url: 'https://cache.test/not-an-object' }), config, cbs);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('no object id') }),
      expect.anything(),
      null,
      expect.anything(),
    );
  });

  it('maps a resolve failure to onError', async () => {
    const { session } = makeSession({
      resolveObjectId: vi.fn(async () => {
        throw new Error('host unreachable');
      }),
    });
    const loader = newLoader(session);
    const { cbs, onError, onSuccess } = callbacks();

    loader.load(ctx({ url: 'https://cache.test/v1/objects/master' }), config, cbs);

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const [error] = onError.mock.calls[0];
    expect(error.text).toContain('host unreachable');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('abort() fires onAbort and suppresses a late success', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { session } = makeSession({
      resolveObjectId: vi.fn(async () => {
        await gate;
        return { handle: 'x' };
      }),
    });
    const loader = newLoader(session);
    const { cbs, onAbort, onSuccess } = callbacks();

    loader.load(ctx({ url: 'https://cache.test/v1/objects/master' }), config, cbs);
    loader.abort();
    release();
    await new Promise((r) => setTimeout(r, 0));

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(loader.stats.aborted).toBe(true);
  });
});

import Hls from 'hls.js';
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderResponse,
} from 'hls.js';
import { parseObjectId } from './SiaLoader.js';
import { withoutQuery, type SignedUrls } from './renewal.js';
import type {
  HybridDeliveryStats,
  HybridPolicy,
  SiaPlaybackSession,
  SiaShareSource,
} from './sia-types.js';

export const DEFAULT_HYBRID_POLICY: Readonly<HybridPolicy> = {
  minBufferSec: 10,
  safetyMarginSec: 4,
  maxSiaWaitMs: 20_000,
  maxFailures: 3,
  pauseMs: 60_000,
};

// a gap this small between the playhead and a buffered range still counts as
// buffered: hls.js jumps holes up to its maxBufferHole on its own
const BUFFER_TOLERANCE_SEC = 0.5;

export interface HybridLoaderOptions {
  session: SiaPlaybackSession;
  assetId: string;
  /** As for `createSiaLoader`: the public share map for `src`, or the authenticated one without it. */
  source?: SiaShareSource;
  /** The element hls.js feeds, read for how much is buffered ahead. */
  media: () => HTMLMediaElement | null;
  /**
   * The current gateway url of each object, for a player that renews signed
   * urls in place (see `renewingLoader`). Without it requests go to the urls
   * hls.js read from the playlists.
   */
  urls?: { readonly current: SignedUrls };
  policy?: Partial<HybridPolicy>;
  /** Called after every media segment with the totals so far. */
  onStats?: (stats: HybridDeliveryStats) => void;
}

/** Seconds buffered ahead of the playhead, 0 when the playhead is outside every range. */
export function bufferAhead(media: HTMLMediaElement | null): number {
  if (!media) return 0;
  const t = media.currentTime;
  const ranges = media.buffered;
  for (let i = 0; i < ranges.length; i++) {
    if (t >= ranges.start(i) - BUFFER_TOLERANCE_SEC && t <= ranges.end(i)) {
      return ranges.end(i) - t;
    }
  }
  return 0;
}

function byteLength(data: LoaderResponse['data']): number {
  if (typeof data === 'string') return data.length;
  return (data as ArrayBuffer | null)?.byteLength ?? 0;
}

/**
 * Build an hls.js `Loader` class that splits a video between the gateway and
 * Sia by how urgently each segment is needed. Playlists always come from the
 * gateway: they are tiny, cached there, and signed per viewer. A media segment
 * comes from Sia only when the buffer already holds `minBufferSec` and the
 * hosts of its object have answered a warm-up read; otherwise (the start, a
 * seek, a nearly empty buffer, Sia still connecting) it comes from the
 * gateway. A Sia read that fails, or that would outlast the buffer, is cut off
 * and the gateway fetches that segment instead, so playback never waits on a
 * slow host. Failures in a row pause Sia for a while.
 *
 * Starting playback never waits for the Sia session: the first segments play
 * through the gateway while the session connects and warms up.
 *
 * State (warm objects, failures, totals) is shared by the loaders of one
 * class, so build a new class for every hls.js instance.
 */
export function createHybridLoader(options: HybridLoaderOptions): {
  new (config: HlsConfig): Loader<LoaderContext>;
} {
  const { session, assetId, source, media, urls, onStats } = options;
  const policy: HybridPolicy = { ...DEFAULT_HYBRID_POLICY, ...options.policy };

  const totals: HybridDeliveryStats = {
    siaBytes: 0,
    gatewayBytes: 0,
    siaSegments: 0,
    gatewaySegments: 0,
    fallbacks: 0,
  };
  let prepared: Promise<boolean> | null = null;
  // objects whose hosts answered a warm-up read, and the ones being warmed
  const warm = new Map<string, 'pending' | 'warm'>();
  // one sia read at a time: each opens connections to the hosts of a slab,
  // and browsers cap how many of those can be pending at once
  let siaBusy = false;
  let failures = 0;
  let pausedUntil = 0;

  const record = (from: 'sia' | 'gateway', bytes: number, fellBack: boolean) => {
    if (from === 'sia') {
      totals.siaBytes += bytes;
      totals.siaSegments += 1;
    } else {
      totals.gatewayBytes += bytes;
      totals.gatewaySegments += 1;
      if (fellBack) totals.fallbacks += 1;
    }
    onStats?.({ ...totals });
  };

  const noteFailure = () => {
    failures += 1;
    if (failures >= policy.maxFailures) {
      failures = 0;
      pausedUntil = Date.now() + policy.pauseMs;
    }
  };

  const prepare = (): Promise<boolean> => {
    if (!prepared) {
      prepared = session.prepare(assetId, ...(source ? [source] : [])).then(
        () => true,
        (err: unknown) => {
          console.warn('Sluby: Sia is unavailable for now, playing through the gateway.', err);
          // try again after the pause rather than never
          prepared = null;
          pausedUntil = Date.now() + policy.pauseMs;
          return false;
        },
      );
    }
    return prepared;
  };

  // read one byte of the object at `offset`, which connects to the hosts of
  // the slab holding it, so the next read from there starts warm
  const warmUp = async (objectId: string, offset: number): Promise<void> => {
    if (warm.has(objectId) || Date.now() < pausedUntil) return;
    warm.set(objectId, 'pending');
    try {
      if (!(await prepare())) {
        warm.delete(objectId);
        return;
      }
      const object = await session.resolveObjectId(assetId, objectId, source);
      const reader = session.download(object, { offset, length: 1 }).getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      warm.set(objectId, 'warm');
    } catch {
      // a later segment of this object tries again
      warm.delete(objectId);
      noteFailure();
    }
  };

  const siaReady = (objectId: string): boolean =>
    !siaBusy &&
    Date.now() >= pausedUntil &&
    warm.get(objectId) === 'warm' &&
    bufferAhead(media()) >= policy.minBufferSec;

  const Base = Hls.DefaultConfig.loader;

  return class HybridLoader extends Base {
    // the sia read in flight, cancelled by abort, destroy or a cut-off
    private siaRead: { cancel: () => void } | null = null;
    private siaCallbacks: LoaderCallbacks<LoaderContext> | null = null;
    private siaContext: LoaderContext | null = null;

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      if (urls) context.url = urls.current.get(withoutQuery(context.url)) ?? context.url;
      const objectId =
        (context.type as string) === 'media-fragment' ? parseObjectId(context.url) : null;
      if (!objectId) {
        // playlists, keys and anything that is not a stored segment
        super.load(context, config, callbacks);
        return;
      }
      void warmUp(objectId, context.rangeStart ?? 0);
      if (siaReady(objectId)) this.viaSia(objectId, context, config, callbacks);
      else this.viaGateway(context, config, callbacks, false);
    }

    private viaGateway(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
      fellBack: boolean,
    ): void {
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          record('gateway', byteLength(response.data), fellBack);
          callbacks.onSuccess(response, stats, ctx, details);
        },
      });
    }

    private viaSia(
      objectId: string,
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      const stats = this.stats;
      stats.loading.start = performance.now();
      this.siaCallbacks = callbacks;
      this.siaContext = context;
      siaBusy = true;

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let done = false;
      const finish = () => {
        done = true;
        clearTimeout(timer);
        siaBusy = false;
        this.siaRead = null;
        this.siaCallbacks = null;
        this.siaContext = null;
      };
      const cancelReader = () => {
        reader?.cancel().catch(() => {
          /* the read is being dropped; a cancel rejection is not actionable */
        });
      };
      // the segment still lands in time when the gateway takes over now
      const fallBack = () => {
        if (done) return;
        finish();
        cancelReader();
        noteFailure();
        // the gateway load measures its own timing from a fresh start
        stats.loading.start = 0;
        stats.loading.first = 0;
        stats.loading.end = 0;
        stats.loaded = 0;
        stats.total = 0;
        stats.chunkCount = 0;
        this.viaGateway(context, config, callbacks, true);
      };
      const budgetMs = Math.min(
        policy.maxSiaWaitMs,
        (bufferAhead(media()) - policy.safetyMarginSec) * 1000,
      );
      const timer = setTimeout(fallBack, Math.max(0, budgetMs));
      this.siaRead = {
        cancel: () => {
          if (done) return;
          finish();
          cancelReader();
        },
      };

      // as in SiaLoader: rangeEnd is exclusive, and a falsy one means the whole object
      const start = context.rangeStart ?? 0;
      const hasRange = typeof context.rangeEnd === 'number' && context.rangeEnd > start;
      const range = hasRange ? { offset: start, length: context.rangeEnd! - start } : {};

      void (async () => {
        try {
          const object = await session.resolveObjectId(assetId, objectId, source);
          if (done) return;
          reader = session.download(object, range).getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (;;) {
            const { value, done: ended } = await reader.read();
            if (done) return;
            if (ended) break;
            if (value) {
              if (stats.loading.first === 0) stats.loading.first = performance.now();
              chunks.push(value);
              total += value.length;
              stats.loaded = total;
              stats.chunkCount += 1;
            }
          }
          const bytes = new Uint8Array(total);
          let at = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.length;
          }
          finish();
          failures = 0;
          if (stats.loading.first === 0) stats.loading.first = performance.now();
          stats.loading.end = performance.now();
          stats.total = total;
          stats.bwEstimate = (total * 8000) / Math.max(1, stats.loading.end - stats.loading.first);
          record('sia', total, false);
          callbacks.onSuccess({ url: context.url, data: bytes.buffer }, stats, context, null);
        } catch {
          fallBack();
        }
      })();
    }

    abort(): void {
      const read = this.siaRead;
      if (!read) {
        super.abort();
        return;
      }
      const callbacks = this.siaCallbacks;
      const context = this.siaContext;
      read.cancel();
      this.stats.aborted = true;
      if (context) callbacks?.onAbort?.(this.stats, context, null);
    }

    destroy(): void {
      this.siaRead?.cancel();
      super.destroy();
    }
  };
}

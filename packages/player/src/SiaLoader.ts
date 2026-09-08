import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from 'hls.js';
import type { SiaPlaybackSession, SiaShareMap } from './types.js';

// hls.js addresses every HLS child as `{base}/v1/objects/{hexId}` (see the
// backend manifest rewriter). The loader pulls the object id out of that URL
// and maps it to a sia:// share URL, so the same stored manifest serves both
// the gateway and this direct-from-Sia path.
const OBJECT_URL_RE = /\/v1\/objects\/([^/?#]+)/;

function parseObjectId(url: string): string | null {
  const m = OBJECT_URL_RE.exec(url);
  return m ? m[1] : null;
}

function emptyStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

/**
 * Build an hls.js `Loader` class that streams every segment and playlist
 * directly from Sia via the SDK's viewer session, instead of fetching the
 * gateway over HTTP. hls.js constructs a loader with only the `HlsConfig`, so
 * the session and the per-playback share map are captured here by closure.
 *
 * One instance is created per load; hls.js calls `load` once, then `abort` or
 * `destroy` on teardown.
 */
export function createSiaLoader(
  session: SiaPlaybackSession,
  shareMap: SiaShareMap,
): { new (config: HlsConfig): Loader<LoaderContext> } {
  return class SiaLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null;
    stats: LoaderStats = emptyStats();

    private callbacks: LoaderCallbacks<LoaderContext> | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private aborted = false;

    // hls.js passes HlsConfig to the constructor; the transport deps come from
    // the closure above.
    constructor(_config: HlsConfig) {}

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.context = context;
      this.callbacks = callbacks;
      const stats = this.stats;
      stats.loading.start = performance.now();

      const objectId = parseObjectId(context.url);
      if (!objectId) {
        this.failNow(`SiaLoader: no object id in "${context.url}"`);
        return;
      }
      const shareUrl = shareMap.shares[objectId];
      if (!shareUrl) {
        this.failNow(`SiaLoader: no share URL for object ${objectId}`);
        return;
      }

      const maxLoadTimeMs = config?.loadPolicy?.maxLoadTimeMs;
      if (typeof maxLoadTimeMs === 'number' && maxLoadTimeMs > 0) {
        this.timeoutId = setTimeout(() => this.onTimeout(), maxLoadTimeMs);
      }

      // hls.js sets rangeEnd EXCLUSIVE; Sia wants an offset + length.
      const hasRange =
        typeof context.rangeStart === 'number' && typeof context.rangeEnd === 'number';
      const options = hasRange
        ? { offset: context.rangeStart, length: context.rangeEnd! - context.rangeStart! }
        : {};
      const wantText = context.responseType !== 'arraybuffer';

      void this.run(context, shareUrl, options, wantText);
    }

    private async run(
      context: LoaderContext,
      shareUrl: string,
      options: { offset?: number; length?: number },
      wantText: boolean,
    ): Promise<void> {
      const stats = this.stats;
      try {
        const object = await session.resolveObject(shareUrl);
        if (this.aborted) return;

        const stream = session.download(object, options);
        const reader = stream.getReader();
        this.reader = reader;

        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (this.aborted) return;
          if (done) break;
          if (value) {
            if (stats.loading.first === 0) stats.loading.first = performance.now();
            chunks.push(value);
            total += value.length;
            stats.loaded = total;
            stats.chunkCount += 1;
          }
        }

        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }

        if (stats.loading.first === 0) stats.loading.first = performance.now();
        stats.loading.end = performance.now();
        stats.total = total;
        this.clearTimeout();

        const data = wantText
          ? new TextDecoder().decode(bytes)
          : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

        this.callbacks?.onSuccess({ url: context.url, data }, stats, context, null);
      } catch (err) {
        if (this.aborted) return;
        this.failNow(`SiaLoader: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    private failNow(text: string): void {
      this.clearTimeout();
      const ctx = this.context;
      if (!ctx) return;
      this.callbacks?.onError({ code: 0, text }, ctx, null, this.stats);
    }

    private onTimeout(): void {
      if (this.aborted) return;
      this.aborted = true;
      this.stats.aborted = true;
      this.cancelReader();
      const ctx = this.context;
      if (ctx) this.callbacks?.onTimeout(this.stats, ctx, null);
    }

    abort(): void {
      if (this.aborted) return;
      this.aborted = true;
      this.stats.aborted = true;
      this.clearTimeout();
      this.cancelReader();
      const ctx = this.context;
      if (ctx) this.callbacks?.onAbort?.(this.stats, ctx, null);
    }

    destroy(): void {
      this.aborted = true;
      this.clearTimeout();
      this.cancelReader();
      this.callbacks = null;
      this.context = null;
    }

    private cancelReader(): void {
      if (this.reader) {
        this.reader.cancel().catch(() => {
          /* the stream is being torn down; a cancel rejection is not actionable */
        });
        this.reader = null;
      }
    }

    private clearTimeout(): void {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    }
  };
}

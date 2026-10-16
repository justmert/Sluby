import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type CSSProperties,
} from 'react';
import Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import type {
  SlubyPlayerProps,
  QualityLevel,
  PlayerState,
  PlaybackResolver,
  SiaPlaybackClient,
} from './types.js';
import type { SiaPlaybackSession, SiaShareSource } from './sia-types.js';
import { createSiaLoader } from './SiaLoader.js';
import { renewingLoader, signedUrlsFor, withoutQuery, type SignedUrls } from './renewal.js';

// ---------------------------------------------------------------------------
// Public imperative handle exposed via ref
// ---------------------------------------------------------------------------

export interface SlubyPlayerHandle {
  /** The underlying HTMLVideoElement, or null before mount. */
  getVideoElement: () => HTMLVideoElement | null;
  /**
   * The current hls.js instance, or null when using native playback. The
   * player builds a new one for every load (another video, a retry), so read
   * it when needed instead of keeping it. A renewed signed URL for the same
   * video keeps the instance.
   */
  getHlsInstance: () => Hls | null;
  /** Renditions in the loaded manifest. Empty on native (Safari) playback. */
  getQualities: () => QualityLevel[];
  /** Pin a rendition by its `index`, or pass -1 to go back to adaptive. */
  setQuality: (levelIndex: number) => void;
  /** Whether hls.js is picking the rendition adaptively. */
  isAutoQuality: () => boolean;
}

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

// direct-from-Sia delivery for one load; `source` is set when the share map
// comes from the public endpoint for `src`
interface SiaDelivery {
  session: SiaPlaybackSession;
  assetId: string;
  source?: SiaShareSource;
}

// one resolved load. A new object means a new load; `key` names the video
// rather than the url, so a reload of the same video keeps its position.
// `src`, `poster` and `expiresAtMs` are what the load started with; a renewal
// replaces them without a new load (see Renewal).
interface Playback {
  // a given src, or one the player resolved from client + assetId
  kind: 'src' | 'asset';
  src: string;
  sia: SiaDelivery | null;
  key: string;
  poster?: string;
  // when src stops working, if a fresh one is needed by then
  expiresAtMs?: number;
  // the retry it was made for, so a retry of a plain src still reloads
  attempt: number;
}

// newly signed urls for a load that keeps playing: what renew or a src prop
// for the same video brought, in place of the ones the load started with
interface Renewal {
  load: Playback;
  src: string;
  poster?: string;
  expiresAtMs?: number;
}

const DEFAULT_MAX_NETWORK_RETRIES = 3;
const DEFAULT_MAX_MEDIA_RETRIES = 2;
// Incremental backoff (ms) before re-attempting a load after a network error.
const NETWORK_RETRY_BACKOFF_MS = 1000;
// renew a signed url this long before it expires (or halfway, if sooner)
const REFRESH_LEAD_MS = 60_000;
// setTimeout fires at once for longer delays
const MAX_TIMER_MS = 2_147_483_647;

function toQualityLevel(
  level: { width: number; height: number; bitrate: number },
  index: number,
): QualityLevel {
  return {
    index,
    width: level.width,
    height: level.height,
    bitrate: level.bitrate,
    name: `${level.height}p`,
  };
}

/** The `expires` (unix seconds) a signed gateway url carries, in ms. */
function expiresFromUrl(url: string): number | undefined {
  const match = /[?&]expires=(\d+)/.exec(url);
  return match ? Number(match[1]) * 1000 : undefined;
}

function hasPlayback(client: PlaybackResolver | SiaPlaybackClient): client is PlaybackResolver {
  return 'playback' in client && typeof (client as PlaybackResolver).playback === 'object';
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function srcPlayback(url: string, attempt: number, sia: SiaDelivery | null = null): Playback {
  return {
    kind: 'src',
    src: url,
    sia,
    key: `src:${withoutQuery(url)}`,
    expiresAtMs: expiresFromUrl(url),
    attempt,
  };
}

// with an asset id and a viewer session, src streams direct from Sia using
// the public share map for it; otherwise it plays as given
async function loadSrc(
  url: string,
  session: SiaPlaybackSession | undefined,
  assetId: string | undefined,
  attempt: number,
): Promise<Playback> {
  const sia = session && assetId ? await prepareSia(session, assetId, { src: url }) : null;
  return srcPlayback(url, attempt, sia);
}

async function loadAsset(
  client: PlaybackResolver,
  assetId: string,
  signed: boolean,
  expiresIn: number | undefined,
  attempt: number,
): Promise<Playback> {
  // The gateway URL is always resolved: it is the http fallback, and in Sia
  // mode it is still the address the custom loader decodes the object id
  // from (the loader never fetches it over HTTP).
  let url = '';
  let posterUrl: string | null = null;
  let expiresAtMs: number | undefined;
  let sign = signed;
  if (!sign) {
    const info = await client.playback.getUrl(assetId);
    // the gateway refuses the unsigned url of a private asset
    if (info.accessTier === 'private') sign = true;
    url = info.playbackUrl;
    posterUrl = info.posterUrl;
  }
  if (sign) {
    const signedInfo = await client.playback.getSignedUrl(assetId, { expiresIn });
    url = signedInfo.signedUrl;
    // the unsigned poster of gated content would be refused, so use the one
    // signed with the manifest (servers before 0.2 send none)
    posterUrl = signedInfo.posterUrl ?? null;
    const parsed = signedInfo.expiresAt ? Date.parse(signedInfo.expiresAt) : NaN;
    expiresAtMs = Number.isFinite(parsed) ? parsed : expiresFromUrl(url);
  }

  // the authenticated share map renews itself, so Sia delivery never depends
  // on the signed url's expiry
  const sia = await prepareSia(client.sia, assetId);
  return {
    kind: 'asset',
    src: url,
    sia,
    key: `asset:${assetId}`,
    poster: posterUrl ?? undefined,
    expiresAtMs: sia ? undefined : expiresAtMs,
    attempt,
  };
}

async function prepareSia(
  session: SiaPlaybackSession | undefined,
  assetId: string,
  source?: SiaShareSource,
): Promise<SiaDelivery | null> {
  // a custom loader cannot apply on the Safari-native path
  if (!session || !Hls.isSupported()) return null;
  try {
    await session.prepare(assetId, ...(source ? [source] : []));
    return source ? { session, assetId, source } : { session, assetId };
  } catch (err) {
    console.warn('Sluby: direct-from-Sia delivery unavailable, using the gateway.', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `<SlubyPlayer>`: a production React component for playing HLS streams
 * stored on Sia.
 *
 * Provide either a `src` (absolute HLS master manifest URL) or a `client`
 * (a `SlubyClient`) plus `assetId`, in which case the player resolves the
 * delivery URL itself. Segments are fetched directly from Sia-backed delivery.
 * With `src`, `assetId` and a `client` that has a Sia session, bytes come
 * straight from Sia hosts through the public share map for `src`, so a page
 * with no API key plays direct from Sia.
 *
 * Features: adaptive quality (hls.js), Safari native HLS fallback, bounded
 * automatic error recovery, renewal of signed URLs before they expire, and
 * loading / error states with an optional built-in overlay.
 */
export const SlubyPlayer = forwardRef<SlubyPlayerHandle, SlubyPlayerProps>(
  function SlubyPlayer(props, ref) {
    const {
      src,
      refreshSrc,
      client,
      assetId,
      signed = false,
      expiresIn,
      poster,
      autoPlay = false,
      controls = true,
      muted = false,
      width,
      height,
      className,
      style,
      overlay = true,
      maxNetworkRetries = DEFAULT_MAX_NETWORK_RETRIES,
      maxMediaRetries = DEFAULT_MAX_MEDIA_RETRIES,
      onReady,
      onPlay,
      onPause,
      onEnd,
      onError,
      onQualityChange,
      onQualitiesChange,
      onDeliveryChange,
      onStateChange,
    } = props;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    // Set once we have reported a terminal (given-up) error, so a follow-on
    // native <video> error event cannot overwrite the authoritative message.
    const terminalRef = useRef(false);
    // where the current video was, so a reload of it (retry, renewed url)
    // continues there instead of at 0
    const positionRef = useRef<{ key: string; time: number; playing: boolean } | null>(null);

    const [state, setState] = useState<PlayerState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // when src will try direct-from-Sia first, start with nothing to load, or
    // the first render would begin fetching src from the gateway before the
    // Sia session is ready
    const [playback, setPlayback] = useState<Playback | null>(() =>
      src && !(client?.sia && assetId && Hls.isSupported()) ? srcPlayback(src, 0) : null,
    );
    const [retryKey, setRetryKey] = useState(0);

    // Keep the latest callbacks and options in refs so the HLS effect does not
    // re-run (and tear down playback) every time a parent re-renders with new
    // closures or flips a flag that only matters at the next load.
    const cb = useRef({
      onReady,
      onPlay,
      onPause,
      onEnd,
      onError,
      onQualityChange,
      onQualitiesChange,
      onDeliveryChange,
      onStateChange,
    });
    const opts = useRef({ autoPlay, maxNetworkRetries, maxMediaRetries, refreshSrc });
    const latest = useRef({ client, assetId, signed, expiresIn });
    const playbackRef = useRef<Playback | null>(playback);
    const [renewal, setRenewal] = useState<Renewal | null>(null);
    const renewalRef = useRef<Renewal | null>(renewal);
    // the current url of each object of the load hls.js is playing, which its
    // loader sends requests to; replaced when the load's urls are renewed
    const signedUrlsRef = useRef<SignedUrls>(new Map());
    // the latest adopt call, so an older one finishing later cannot win
    const adoptSeq = useRef(0);
    useEffect(() => {
      cb.current = {
        onReady,
        onPlay,
        onPause,
        onEnd,
        onError,
        onQualityChange,
        onQualitiesChange,
        onDeliveryChange,
        onStateChange,
      };
      opts.current = { autoPlay, maxNetworkRetries, maxMediaRetries, refreshSrc };
      latest.current = { client, assetId, signed, expiresIn };
      playbackRef.current = playback;
      renewalRef.current = renewal;
    });

    // ── State transitions notify the consumer once, on change ──────────────

    // every transition is reported as it happens, in order: reporting from an
    // effect on `state` would drop one that react batched away (a quick
    // manifest turned loading into ready within one render)
    const stateRef = useRef<PlayerState>('idle');
    const moveTo = useCallback((next: PlayerState | ((current: PlayerState) => PlayerState)) => {
      const value = typeof next === 'function' ? next(stateRef.current) : next;
      if (value === stateRef.current) return;
      stateRef.current = value;
      setState(value);
      cb.current.onStateChange?.(value);
    }, []);
    useEffect(() => {
      cb.current.onStateChange?.(stateRef.current);
      // only the state the player starts in; moveTo reports the rest
    }, []);

    const fail = useCallback(
      (message: string, cause?: unknown) => {
        setErrorMessage(message);
        moveTo('error');
        cb.current.onError?.(new Error(message, cause === undefined ? undefined : { cause }));
      },
      [moveTo],
    );

    // `signed` and `expiresIn` only apply when the player signs, which it
    // never does for a given src
    const hasSrc = Boolean(src);
    useEffect(() => {
      if (hasSrc && (signed || expiresIn !== undefined)) {
        console.warn(
          'Sluby: signed and expiresIn are ignored when src is given; sign src on your ' +
            'server and pass refreshSrc to renew it before it expires.',
        );
      }
    }, [hasSrc, signed, expiresIn]);

    // ── Renewed urls for the same video ────────────────────────────────────

    // the urls a load is playing now: its renewal's, or the ones it started with
    const liveOf = useCallback((load: Playback) => {
      const r = renewalRef.current;
      return r && r.load === load ? r : load;
    }, []);

    /**
     * Move `current` onto the urls of `next`, a newer resolve of the same
     * video. Rebuilding hls.js for a new signature would throw away the
     * buffer and seek back to the position, so while hls.js plays the video
     * the new urls take over in place: the gateway urls hls.js asks for next
     * are mapped onto the renewed ones, or the Sia share map is fetched for
     * the renewed src. Native playback, a different video or a change of
     * delivery path still loads `next`. Resolves to whether it did that.
     */
    const adopt = useCallback(
      async (current: Playback, next: Playback): Promise<boolean> => {
        const inPlace =
          hlsRef.current !== null &&
          next.key === current.key &&
          Boolean(next.sia) === Boolean(current.sia);
        if (!inPlace) {
          setPlayback(next);
          return true;
        }
        const seq = ++adoptSeq.current;
        const source = current.sia?.source;
        let urls: SignedUrls | null = null;
        if (source) await current.sia!.session.prepare(current.sia!.assetId, { src: next.src });
        else if (!current.sia) urls = await signedUrlsFor(next.src);
        // a newer load (a prop change, a retry) has replaced this one
        if (playbackRef.current !== current) return true;
        // a newer renewal of it has
        if (seq !== adoptSeq.current) return false;
        if (urls) signedUrlsRef.current = urls;
        // the loader reads the share source on every request
        if (source) source.src = next.src;
        const renewed: Renewal = {
          load: current,
          src: next.src,
          poster: next.poster ?? liveOf(current).poster,
          expiresAtMs: next.expiresAtMs,
        };
        renewalRef.current = renewed;
        setRenewal(renewed);
        return false;
      },
      [liveOf],
    );

    // ── Resolve what to play from src, or from client + assetId ────────────

    useEffect(() => {
      let cancelled = false;

      if (src) {
        const session = client?.sia;
        const viaSia = Boolean(session && assetId && Hls.isSupported());
        // a newly signed src for the video already playing, on the same
        // delivery path, renews the load instead of starting another
        const prev = playbackRef.current;
        if (
          prev &&
          prev.kind === 'src' &&
          prev.attempt === retryKey &&
          prev.key === srcPlayback(src, retryKey).key &&
          (viaSia ? prev.sia?.session === session && prev.sia?.assetId === assetId : !prev.sia)
        ) {
          if (liveOf(prev).src === src) return;
          if (hlsRef.current) {
            adopt(prev, srcPlayback(src, retryKey, prev.sia)).catch((err: unknown) => {
              if (!cancelled) {
                fail(`Could not switch to the new playback URL: ${asError(err).message}`, err);
              }
            });
            return () => {
              cancelled = true;
            };
          }
        }

        if (!viaSia) {
          setPlayback(srcPlayback(src, retryKey));
          return;
        }

        // nothing loads until the session answers, so a retry or a new src
        // cannot start a stale load first
        setPlayback(null);
        moveTo('loading');
        void loadSrc(src, session, assetId!, retryKey).then((next) => {
          if (!cancelled) setPlayback(next);
        });
        return () => {
          cancelled = true;
        };
      }

      if (!client || !assetId) {
        setPlayback(null);
        return;
      }

      if (!hasPlayback(client)) {
        setPlayback(null);
        fail(
          'SlubyPlayer needs a client with playback (a SlubyClient) to play an assetId without src.',
        );
        return;
      }

      // Clear any prior load synchronously so a Retry cannot re-initialise on
      // a stale or expired url before the fresh resolve below lands.
      setPlayback(null);
      moveTo('loading');
      loadAsset(client, assetId, signed, expiresIn, retryKey).then(
        (next) => {
          if (!cancelled) setPlayback(next);
        },
        (err: unknown) => {
          if (!cancelled) fail(asError(err).message || 'Failed to resolve playback URL', err);
        },
      );

      return () => {
        cancelled = true;
      };
    }, [src, client, assetId, signed, expiresIn, retryKey, fail, moveTo, adopt, liveOf]);

    // ── Renew a signed url before it expires ───────────────────────────────

    // whether a load's url can be renewed: one the player signed itself, or a
    // given src when the page passed refreshSrc
    const renewable = useCallback(
      (current: Playback) =>
        liveOf(current).expiresAtMs !== undefined &&
        (current.kind === 'asset' || opts.current.refreshSrc !== undefined),
      [liveOf],
    );

    // resolves to whether it started a new load rather than renewing this one
    const renew = useCallback(
      async (current: Playback): Promise<boolean> => {
        let next: Playback;
        const { client: resolver, assetId: id, signed: sign, expiresIn: ttl } = latest.current;
        if (current.kind === 'src') {
          const fresh = await opts.current.refreshSrc!(liveOf(current).src);
          next = srcPlayback(fresh, current.attempt, current.sia);
        } else {
          if (!resolver || !id || !hasPlayback(resolver)) {
            throw new Error(
              'The playback URL expired and the player no longer has a client to renew it.',
            );
          }
          next = await loadAsset(resolver, id, sign, ttl, current.attempt);
        }
        // a newer load (a prop change, a retry) has replaced this one
        if (playbackRef.current !== current) return true;
        return adopt(current, next);
      },
      [adopt, liveOf],
    );

    // read from state, not the ref, so a renewal re-arms the timer
    const live = playback && renewal?.load === playback ? renewal : playback;
    const liveExpiresAtMs = live?.expiresAtMs;
    useEffect(() => {
      if (!playback || !renewable(playback)) return;
      const expiresAtMs = liveExpiresAtMs!;
      const remaining = expiresAtMs - Date.now();
      const delay = remaining - Math.min(REFRESH_LEAD_MS, Math.max(0, remaining) / 2);
      if (delay > MAX_TIMER_MS) return;
      const timer = setTimeout(
        () => {
          renew(playback).catch((err: unknown) => {
            // the url still works for a while; a load failing after the expiry
            // tries again and reports the error if that fails too
            console.warn('Sluby: could not renew the signed playback URL.', err);
          });
        },
        Math.max(0, delay),
      );
      return () => clearTimeout(timer);
    }, [playback, liveExpiresAtMs, renew, renewable, liveOf]);

    // ── Imperative handle ──────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        getVideoElement: () => videoRef.current,
        getHlsInstance: () => hlsRef.current,
        getQualities: () =>
          hlsRef.current?.levels.map((level, i) => toQualityLevel(level, i)) ?? [],
        setQuality: (levelIndex: number) => {
          const hls = hlsRef.current;
          if (!hls) return;
          // -1 hands the choice back to hls.js's abr controller
          hls.currentLevel = levelIndex >= 0 && levelIndex < hls.levels.length ? levelIndex : -1;
        },
        isAutoQuality: () => hlsRef.current?.autoLevelEnabled ?? true,
      }),
      [],
    );

    // ── Video element event forwarding ─────────────────────────────────────

    const handlePlay = useCallback(() => cb.current.onPlay?.(), []);
    const handlePause = useCallback(() => cb.current.onPause?.(), []);
    const handleEnded = useCallback(() => cb.current.onEnd?.(), []);
    const handleWaiting = useCallback(() => {
      moveTo((s) => (s === 'error' ? s : 'buffering'));
    }, [moveTo]);
    const handlePlaying = useCallback(() => {
      moveTo((s) => (s === 'error' ? s : 'ready'));
    }, [moveTo]);
    const handleVideoError = useCallback(() => {
      const video = videoRef.current;
      const mediaError = video?.error;
      // A terminal HLS error already reported the authoritative message; a
      // native error from MSE detaching afterwards must not overwrite it.
      if (terminalRef.current) return;
      // hls.js surfaces its own errors; only report a native <video> error when
      // we are not driving playback through hls.js (Safari native path).
      if (hlsRef.current) return;
      const message = mediaError
        ? `MediaError code ${mediaError.code}: ${mediaError.message || 'Unknown media error'}`
        : 'Unknown video error';
      fail(message, mediaError ?? undefined);
    }, [fail]);

    // ── HLS initialisation & lifecycle ─────────────────────────────────────

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !playback) return;
      const current = playback;

      setErrorMessage(null);
      moveTo('loading');
      terminalRef.current = false;

      // continue where this video was, after a retry or a renewed url
      const resume = positionRef.current?.key === current.key ? positionRef.current : null;
      if (!resume) positionRef.current = null;
      const shouldPlay = () => opts.current.autoPlay || Boolean(resume?.playing);

      // track the position of this load; detached before teardown, which
      // resets the element to 0 and paused
      const track = () => {
        if (video.currentTime > 0) {
          positionRef.current = {
            key: current.key,
            time: video.currentTime,
            playing: !video.paused && !video.ended,
          };
        }
      };
      const trackedEvents = ['timeupdate', 'play', 'pause', 'seeked'] as const;
      for (const name of trackedEvents) video.addEventListener(name, track);
      const stopTracking = () => {
        for (const name of trackedEvents) video.removeEventListener(name, track);
      };

      // ------------------------------------------------------------------
      // Native HLS support (e.g. Safari on macOS / iOS)
      // ------------------------------------------------------------------
      if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = current.src;
        cb.current.onDeliveryChange?.('gateway');

        const onNativeLoaded = () => {
          if (resume && resume.time > 0) video.currentTime = resume.time;
          moveTo('ready');
          cb.current.onReady?.();
          if (shouldPlay()) {
            video.play().catch(() => {
              /* autoplay policy may block */
            });
          }
        };
        video.addEventListener('loadedmetadata', onNativeLoaded, { once: true });

        return () => {
          stopTracking();
          video.removeEventListener('loadedmetadata', onNativeLoaded);
          video.removeAttribute('src');
          video.load();
        };
      }

      // ------------------------------------------------------------------
      // hls.js path
      // ------------------------------------------------------------------
      if (!Hls.isSupported()) {
        stopTracking();
        fail('HLS is not supported in this browser and native HLS is unavailable.');
        return;
      }

      const hlsConfig: Partial<HlsConfig> = {
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1, // auto (adaptive)
        startPosition: resume && resume.time > 0 ? resume.time : -1,
      };

      // Direct-from-Sia: a custom loader streams every playlist and segment
      // from Sia via the viewer session (loaders run on the main thread, so
      // this is compatible with enableWorker). Setting `loader` covers
      // manifest, level, fragment, and key loads. Absent -> gateway HTTP.
      const sia = current.sia;
      if (sia) {
        hlsConfig.loader = createSiaLoader(sia.session, sia.assetId, sia.source);
      } else {
        signedUrlsRef.current = new Map();
        hlsConfig.loader = renewingLoader(signedUrlsRef);
      }

      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;
      cb.current.onDeliveryChange?.(sia ? 'sia' : 'gateway');

      // Bounded recovery counters. Reset once real data buffers so that
      // intermittent, well-separated errors do not exhaust the budget.
      let networkRetries = 0;
      let mediaRetries = 0;
      let backoffTimer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;
      let renewing = false;
      // startLoad only resumes loading once a manifest has been parsed, so a
      // failed manifest load has to be retried with loadSource instead
      let manifestParsed = false;

      // webkit can leave the clock stopped for good (playing, readyState 4,
      // currentTime frozen) when play() is pending while hls.js seeks, to the
      // start position of a resumed load or over the gap before the first
      // buffered frame, so play() waits until the element has settled
      const settleEvents = ['seeked', 'canplay'] as const;
      const stopWaitingToPlay = () => {
        for (const name of settleEvents) video.removeEventListener(name, playWhenSettled);
      };
      const playWhenSettled = () => {
        if (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
        stopWaitingToPlay();
        video.play().catch(() => {
          /* autoplay policy may block */
        });
      };

      // Tear down after an unrecoverable error, exactly once: cancel any pending
      // reload so its callback cannot fire on a destroyed instance, mark the
      // error terminal, destroy, and report.
      const giveUp = (message: string, cause?: unknown) => {
        if (backoffTimer) clearTimeout(backoffTimer);
        if (destroyed) return;
        destroyed = true;
        terminalRef.current = true;
        stopTracking();
        stopWaitingToPlay();
        hls.destroy();
        hlsRef.current = null;
        fail(message, cause);
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        cb.current.onQualitiesChange?.(hls.levels.map((level, i) => toQualityLevel(level, i)));
        if (hls.currentLevel >= 0 && hls.currentLevel < hls.levels.length) {
          cb.current.onQualityChange?.(
            toQualityLevel(hls.levels[hls.currentLevel], hls.currentLevel),
          );
        }
        moveTo('ready');
        cb.current.onReady?.();
        if (!shouldPlay()) return;
        for (const name of settleEvents) video.addEventListener(name, playWhenSettled);
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        // Real media is flowing; forgive earlier transient errors.
        networkRetries = 0;
        mediaRetries = 0;
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) cb.current.onQualityChange?.(toQualityLevel(level, data.level));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || destroyed) return; // non-fatal errors are auto-handled by hls.js

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            // past the signed url's expiry every retry would be refused too,
            // so get a fresh url and carry on with it
            const expired =
              renewable(current) && Date.now() >= liveOf(current).expiresAtMs! - REFRESH_LEAD_MS;
            if (expired) {
              if (renewing) return;
              renewing = true;
              moveTo('buffering');
              renew(current).then(
                (reloaded) => {
                  renewing = false;
                  if (reloaded || destroyed) return;
                  // the next requests go to the renewed urls
                  networkRetries = 0;
                  if (manifestParsed) hls.startLoad();
                  else hls.loadSource(current.src);
                },
                (err: unknown) =>
                  giveUp(
                    `The playback URL expired and could not be renewed (${data.details}).`,
                    err,
                  ),
              );
              return;
            }
            if (networkRetries < opts.current.maxNetworkRetries) {
              networkRetries += 1;
              moveTo('buffering');
              if (backoffTimer) clearTimeout(backoffTimer);
              backoffTimer = setTimeout(
                () => (manifestParsed ? hls.startLoad() : hls.loadSource(current.src)),
                NETWORK_RETRY_BACKOFF_MS * networkRetries,
              );
            } else {
              giveUp(
                `Network error, gave up after ${opts.current.maxNetworkRetries} retries (${data.details}).`,
                data.error,
              );
            }
            break;
          }
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaRetries < opts.current.maxMediaRetries) {
              mediaRetries += 1;
              moveTo('buffering');
              hls.recoverMediaError();
            } else {
              giveUp(
                `Media error, gave up after ${opts.current.maxMediaRetries} retries (${data.details}).`,
                data.error,
              );
            }
            break;
          default:
            giveUp(`Fatal HLS error: ${data.type} / ${data.details}`, data.error);
            break;
        }
      });

      hls.attachMedia(video);
      hls.loadSource(current.src);

      return () => {
        if (backoffTimer) clearTimeout(backoffTimer);
        stopTracking();
        stopWaitingToPlay();
        // A give-up already destroyed the instance; do not destroy twice.
        if (!destroyed) {
          destroyed = true;
          hls.destroy();
        }
        hlsRef.current = null;
      };
    }, [playback, fail, renew, renewable, moveTo, liveOf]);

    // ── Retry (from the overlay button) ────────────────────────────────────

    const handleRetry = useCallback(() => {
      setErrorMessage(null);
      moveTo('loading');
      setRetryKey((k) => k + 1);
    }, [moveTo]);

    // ── Render ─────────────────────────────────────────────────────────────

    const showSpinner = overlay && (state === 'loading' || state === 'buffering');
    const showError = overlay && state === 'error';

    return (
      <div
        className={className}
        style={{ position: 'relative', display: 'inline-block', width, height, ...style }}
      >
        <video
          ref={videoRef}
          poster={poster ?? live?.poster}
          controls={controls}
          muted={muted}
          width={width}
          height={height}
          style={{ display: 'block', width: '100%', height: '100%' }}
          playsInline
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onError={handleVideoError}
        />

        {showSpinner && (
          <div style={OVERLAY_STYLE} data-sluby-overlay="loading" role="status">
            <Spinner />
            <span style={VISUALLY_HIDDEN_STYLE}>Loading video</span>
          </div>
        )}

        {showError && (
          <div style={OVERLAY_STYLE} data-sluby-overlay="error" role="alert">
            <div style={{ textAlign: 'center', color: '#fff', padding: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 14 }}>
                {errorMessage ?? 'Playback error'}
              </div>
              <button type="button" onClick={handleRetry} style={RETRY_BUTTON_STYLE}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);

// The spinner turns through the Web Animations API rather than a stylesheet,
// so the player needs no <style> element (no `style-src 'unsafe-inline'` under
// a CSP) and puts no class or keyframe names in the page's global namespace.
function Spinner() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: reduced ? 2400 : 800,
      iterations: Infinity,
      easing: 'linear',
    });
    return () => animation.cancel();
  }, []);
  return <div ref={ref} style={SPINNER_STYLE} data-sluby-spinner="" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Inline overlay styling (dependency-free)
// ---------------------------------------------------------------------------

const OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.45)',
  pointerEvents: 'none',
};

const RETRY_BUTTON_STYLE: CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '8px 16px',
  fontSize: 14,
  color: '#000',
  background: '#fff',
  border: 'none',
  borderRadius: 4,
};

const SPINNER_STYLE: CSSProperties = {
  width: 42,
  height: 42,
  boxSizing: 'border-box',
  border: '4px solid rgba(255, 255, 255, 0.25)',
  borderTopColor: '#fff',
  borderRadius: '50%',
};

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

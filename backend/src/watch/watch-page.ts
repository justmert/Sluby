import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * The public watch page at /watch/:id: one video on a page of its own, for a
 * link to send or an iframe to embed. The page is rendered here. When the web
 * image was built with a viewer identity, its player (/studio/watch-player.js)
 * plays the video hybrid: the first seconds relayed by this server, the rest
 * read by the browser straight from the Sia hosts. Otherwise, and where that
 * player cannot run, hls.js from the installed npm package plays it through
 * the gateway. Nothing loads from a CDN.
 */

/** The web image serves the hybrid player here, next to the studio build. */
export const WATCH_HYBRID_PLAYER = '/studio/watch-player.js';

export const WATCH_ASSET_PATH = '/watch/assets';

const require = createRequire(import.meta.url);
// read once at startup: a missing build is a broken install, not a 404 later
const HLS_SCRIPT = readFileSync(require.resolve('hls.js/dist/hls.min.js'), 'utf8');

// plays the stream named on the video element. hls.js where media source
// extensions exist, the browser's own hls otherwise (safari on an iphone).
// fatal network errors retry a few times, media errors try a recovery, and
// anything else says the video cannot play rather than leaving a black box
const PLAYER_SCRIPT = `(function () {
  // the hybrid player is a module, which runs after this script but before
  // DOMContentLoaded, and says so when it takes the video
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  function run() {
  if (window.slubyWatchHybrid) return;
  var video = document.getElementById('video');
  var notice = document.getElementById('notice');
  var src = video.getAttribute('data-src');
  var params = new URLSearchParams(location.search);
  if (params.get('muted') === '1' || params.get('autoplay') === '1') video.muted = true;
  if (params.get('loop') === '1') video.loop = true;
  var autoplay = params.get('autoplay') === '1';
  function fail(message) {
    notice.textContent = message;
    notice.hidden = false;
  }
  function start() {
    if (!autoplay) return;
    var played = video.play();
    if (played && played.catch) played.catch(function () {});
  }
  if (window.Hls && window.Hls.isSupported()) {
    var hls = new window.Hls({ enableWorker: true });
    var networkRetries = 0;
    var mediaRetries = 0;
    hls.on(window.Hls.Events.MANIFEST_PARSED, start);
    hls.on(window.Hls.Events.FRAG_BUFFERED, function () {
      networkRetries = 0;
      mediaRetries = 0;
    });
    hls.on(window.Hls.Events.ERROR, function (_event, data) {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        networkRetries += 1;
        setTimeout(function () { hls.startLoad(); }, 1000 * networkRetries);
        return;
      }
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
        mediaRetries += 1;
        hls.recoverMediaError();
        return;
      }
      hls.destroy();
      fail('This video could not be played. Try again later.');
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.addEventListener('loadedmetadata', start, { once: true });
    video.addEventListener('error', function () {
      fail('This video could not be played. Try again later.');
    });
  } else {
    fail('This browser cannot play this video.');
  }
  }
})();
`;

const STYLES = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;color:#fafaf9;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
main{position:relative;display:grid;place-items:center;height:100%}
video{width:100%;height:100%;max-height:100vh;background:#000;object-fit:contain}
#notice{position:absolute;inset:auto 16px 16px;margin:0;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,.75);text-align:center}
#notice[hidden]{display:none}
.message{max-width:28rem;padding:24px;text-align:center}
.message h1{margin:0 0 8px;font-size:18px;font-weight:600}
.message p{margin:0;color:#a8a29e}
`;

/** The scripts and stylesheet the page loads, by file name under WATCH_ASSET_PATH. */
export const WATCH_ASSETS: Record<string, { type: string; body: string }> = {
  'hls.min.js': { type: 'text/javascript; charset=utf-8', body: HLS_SCRIPT },
  'watch.js': { type: 'text/javascript; charset=utf-8', body: PLAYER_SCRIPT },
  'watch.css': { type: 'text/css; charset=utf-8', body: STYLES },
};

/**
 * Only this origin's own files and media, and any page may frame it, since
 * being embedded is what the page is for. The hybrid player compiles the Sia
 * SDK's WebAssembly and connects over https and WebTransport to the indexer
 * and to Sia hosts, whose addresses are not known in advance.
 */
export const WATCH_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' https:",
  // hls.js transmuxes in a worker it starts from a blob url
  "worker-src 'self' blob:",
  'frame-ancestors *',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function shell(opts: { title: string; head?: string; body: string; index: boolean }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    ${opts.index ? '' : '<meta name="robots" content="noindex" />'}
    <link rel="stylesheet" href="${WATCH_ASSET_PATH}/watch.css" />${opts.head ?? ''}
  </head>
  <body>
    ${opts.body}
  </body>
</html>
`;
}

export interface WatchPageInput {
  title: string;
  /** The asset or pb_ playback id the page was opened with. */
  videoId: string;
  /** The stream to play, a path on this server with any signature on it. */
  streamPath: string;
  /** A poster path on this server, or null when the video has none. */
  posterPath: string | null;
  /** This page's own address, for link previews. */
  pageUrl: string;
  /** An absolute poster address for link previews; only for public videos. */
  previewImageUrl: string | null;
  /** A signed page is one person's link: keep it out of search and previews. */
  signed: boolean;
}

export function renderWatchPage(input: WatchPageInput): string {
  const title = input.title.trim() || 'Video';
  const meta = input.signed
    ? ''
    : `
    <meta property="og:type" content="video.other" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:url" content="${escapeHtml(input.pageUrl)}" />${
      input.previewImageUrl
        ? `
    <meta property="og:image" content="${escapeHtml(input.previewImageUrl)}" />`
        : ''
    }`;
  const poster = input.posterPath ? ` poster="${escapeHtml(input.posterPath)}"` : '';
  return shell({
    title,
    head: meta,
    index: !input.signed,
    body: `<main>
      <video id="video" controls playsinline preload="metadata"${poster} data-src="${escapeHtml(input.streamPath)}" data-id="${escapeHtml(input.videoId)}" aria-label="${escapeHtml(title)}"></video>
      <p id="notice" role="alert" hidden></p>
    </main>
    <script src="${WATCH_ASSET_PATH}/hls.min.js"></script>
    <script src="${WATCH_ASSET_PATH}/watch.js"></script>
    <script type="module" src="${WATCH_HYBRID_PLAYER}"></script>`,
  });
}

/** A page that says why there is no video to show. */
export function renderWatchMessage(heading: string, detail: string): string {
  return shell({
    title: heading,
    index: false,
    body: `<main>
      <div class="message">
        <h1>${escapeHtml(heading)}</h1>
        <p>${escapeHtml(detail)}</p>
      </div>
    </main>`,
  });
}

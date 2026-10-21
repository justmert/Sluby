// the public watch page's player when the web image has a viewer identity:
// the backend renders /watch/:id, and this file, served by the web container
// at /studio/watch-player.js, plays the video hybrid. the page's classic
// script plays it through the gateway when this file is missing, when there
// is no viewer identity, or where hls.js cannot run
import Hls from 'hls.js';
import { SlubyClient } from '@sluby/sdk';
import { createHybridLoader } from '@sluby/player/hls';

declare global {
  interface Window {
    slubyWatchHybrid?: boolean;
  }
}

// the same policy as the studio player, measured on app.sluby.app
const POLICY = { minBufferSec: 5, safetyMarginSec: 2 };

function viewer() {
  const indexerUrl = import.meta.env.VITE_SLUBY_SIA_INDEXER_URL;
  const appId = import.meta.env.VITE_SLUBY_SIA_APP_ID;
  const appKey = import.meta.env.VITE_SLUBY_SIA_APP_KEY;
  if (!indexerUrl || !appId || !appKey) return null;
  return { indexerUrl, appId, appKey, name: 'Sluby watch page' };
}

function play(
  video: HTMLVideoElement,
  notice: HTMLElement,
  sia: NonNullable<ReturnType<typeof viewer>>,
) {
  const src = new URL(video.dataset.src!, location.href).href;
  const params = new URLSearchParams(location.search);
  const autoplay = params.get('autoplay') === '1';
  if (params.get('muted') === '1' || autoplay) video.muted = true;
  if (params.get('loop') === '1') video.loop = true;

  const fail = (message: string) => {
    notice.textContent = message;
    notice.hidden = false;
  };

  const client = new SlubyClient({ baseUrl: location.origin, sia });
  const hls = new Hls({
    enableWorker: true,
    loader: createHybridLoader({
      session: client.sia!,
      assetId: video.dataset.id!,
      source: { src },
      media: () => video,
      policy: POLICY,
    }),
  });
  let networkRetries = 0;
  let mediaRetries = 0;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (autoplay) video.play().catch(() => {});
  });
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    networkRetries = 0;
    mediaRetries = 0;
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
      networkRetries += 1;
      setTimeout(() => hls.startLoad(), 1000 * networkRetries);
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
      mediaRetries += 1;
      hls.recoverMediaError();
      return;
    }
    hls.destroy();
    fail('This video could not be played. Try again later.');
  });
  hls.loadSource(src);
  hls.attachMedia(video);
}

const video = document.getElementById('video');
const notice = document.getElementById('notice');
const sia = viewer();
if (video instanceof HTMLVideoElement && notice && sia && video.dataset.src && Hls.isSupported()) {
  // claimed before the page's own script runs, so only one player starts
  window.slubyWatchHybrid = true;
  play(video, notice, sia);
}

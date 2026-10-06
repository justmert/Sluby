import Hls from 'hls.js';
import { createSiaLoader } from '@sluby/player/hls';

/**
 * @typedef {object} Playback
 * @property {Hls | null} hls null when the browser plays HLS natively
 * @property {'sia' | 'gateway'} delivery where the video bytes come from
 * @property {() => void} destroy stops playback and frees the player
 */

/**
 * Pick an asset's playback url and start it on a <video> element.
 *
 * @param {HTMLVideoElement} video
 * @param {import('@sluby/sdk').SlubyClient} client
 * @param {string} assetId asset id or pb_ playback id
 * @param {{ src?: string, signed?: boolean, onFatalError?: (message: string) => void }} [options]
 *   `src` plays a url you already have, such as a signed url your server
 *   minted; `signed` has the client mint one, which needs an api key
 * @returns {Promise<Playback>}
 */
export async function playAsset(video, client, assetId, options = {}) {
  // a public asset plays from its stream url, built without a request or a
  // key. a private one only plays from a signed url; the gateway signs every
  // playlist and segment url inside the manifest it serves
  const url =
    options.src ??
    (options.signed
      ? (await client.playback.getSignedUrl(assetId, { expiresIn: 3600 })).signedUrl
      : client.playback.streamUrl(assetId));

  if (Hls.isSupported()) {
    /** @type {Partial<import('hls.js').HlsConfig>} */
    const config = {};
    /** @type {'sia' | 'gateway'} */
    let delivery = 'gateway';
    if (client.sia) {
      // connect the viewer session and fetch the share map up front, so a
      // broken viewer key shows up here and not halfway into playback. with
      // { src } the map comes from the public share endpoint for that url,
      // carrying its signature if it has one, so no api key is involved
      await client.sia.prepare(assetId, { src: url });
      config.loader = createSiaLoader(client.sia, assetId, { src: url });
      delivery = 'sia';
    }

    const hls = new Hls(config);
    let networkRetries = 0;
    let mediaRetries = 0;
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      networkRetries = 0;
      mediaRetries = 0;
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      // hls.js retries non-fatal errors itself
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        networkRetries += 1;
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
        mediaRetries += 1;
        hls.recoverMediaError();
      } else {
        hls.destroy();
        options.onFatalError?.(`${data.type}: ${data.details}`);
      }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return { hls, delivery, destroy: () => hls.destroy() };
  }

  // iphones without managedmediasource cannot run hls.js, but play hls natively. a
  // custom loader cannot run there, so bytes always come from the gateway.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    return {
      hls: null,
      delivery: 'gateway',
      destroy: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  throw new Error('This browser cannot play HLS.');
}

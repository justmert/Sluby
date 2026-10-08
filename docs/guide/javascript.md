# Plain JavaScript

This guide uses Sluby without a framework: `@sluby/sdk` for the API and hls.js for playback in the browser, plus Node.js on the server for uploads and for handing out playback. Every snippet comes from the runnable example in [`examples/vanilla`](https://github.com/justmert/Sluby/tree/main/examples/vanilla), plain JavaScript modules that CI typechecks (with `checkJs`) and builds against the current packages.

You need a running Sluby stack (see the [quickstart](./quickstart)) and an API key from **Settings → API keys** in the Studio. If you use React, the [React guide](./react) covers the same flow with `<SlubyPlayer>`.

## Install

```sh
npm install @sluby/sdk @sluby/player hls.js
```

`@sluby/player` is only needed for direct-from-Sia playback. Its `@sluby/player/hls` entry point exports the hls.js loader on its own and does not import React, but npm still installs React, because it is a peer dependency of the package's main entry.

::: warning Package versions
This guide needs a release of `@sluby/sdk` and `@sluby/player` newer than 0.1.0. Version 0.1.0 on npm predates direct-from-Sia playback, `assets.processing` and the `@sluby/player/hls` entry point. Until a newer version is published, the example apps use the packages built from this repository (`npm install`, `npm run build:sdk` and `npm run build:player` at the repository root).
:::

## Keep keys on your server

An API key has scopes: `upload` creates uploads, `read` lists and reads every asset of the account (including signed URLs for private ones and Sia share maps), and `manage` edits and deletes assets and manages keys and webhooks. Anything in a browser bundle is readable by whoever loads the page, and the API has no short-lived or per-viewer tokens, so:

- upload from your server with an `upload` key ([Upload from a server](#upload-from-a-server))
- play in the browser with no key at all: a public asset from its stream URL, direct from Sia included, and a private one from a signed URL your server mints ([Mint signed URLs on your server](#mint-signed-urls-on-your-server))

The browser part of the example accepts a key in a form field so the whole flow can be tried against a local stack. That is for development only.

## Create a client

```js
function getClient() {
  const config = {
    baseUrl: baseUrlInput.value.trim(),
    deliveryBaseUrl: deliveryUrlInput.value.trim() || undefined,
    // playback needs no key; uploading, deleting and minting signed urls do
    apiKey: apiKeyInput.value.trim() || undefined,
    sia:
      siaIndexerInput.value && siaAppIdInput.value && siaAppKeyInput.value
        ? {
            indexerUrl: siaIndexerInput.value.trim(),
            appId: siaAppIdInput.value.trim(),
            appKey: siaAppKeyInput.value.trim(),
          }
        : undefined,
  };
  const key = JSON.stringify(config);
  if (!client || key !== clientKey) {
    client = new SlubyClient(config);
    clientKey = key;
  }
  return client;
}
```

`baseUrl` is the REST API, `deliveryBaseUrl` is where the browser fetches manifests and segments (it defaults to `baseUrl`), `apiKey` is sent as a bearer token on API calls only, and `sia` is the optional viewer identity for direct-from-Sia playback. The constructor throws on an empty `apiKey` string, so pass `undefined` instead. The example keeps one client per configuration, so the Sia viewer session is reused between plays.

## Upload from the browser

```js
const sluby = getClient();
const accessTier = tierSelect.value === 'private' ? 'private' : 'public';
const upload = sluby.uploads.upload(file, {
  title: file.name,
  accessTier,
  onProgress: (percent) => {
    progressBar.value = percent;
    uploadStatus.textContent = `Uploading: ${percent}%`;
  },
});
currentUpload = upload;

// the asset exists as soon as the upload starts
const assetId = await upload.assetId;
assetIdInput.value = assetId;
signedInput.checked = accessTier === 'private';
await upload;
```

`uploads.upload` creates the asset and sends the file with resumable tus uploads. The returned promise settles when the bytes are uploaded, and its `assetId` promise resolves as soon as the asset exists. `onProgress` also receives the uploaded and total byte counts. The handle has `pause()`, `resume()`, `abort()` and `isPaused`:

```js
pauseButton.addEventListener('click', async () => {
  if (!currentUpload) return;
  if (currentUpload.isPaused) {
    currentUpload.resume();
    pauseButton.textContent = 'Pause';
  } else {
    await currentUpload.pause();
    pauseButton.textContent = 'Resume';
  }
});
```

## Wait until it is ready

```js
const stagePoll = setInterval(async () => {
  try {
    const job = await sluby.assets.processing(assetId);
    uploadStatus.textContent = `Processing: ${job.stage}, ${job.progressPercent}%`;
  } catch {
    // the next poll tries again; waitForReady below reports real failures
  }
}, 3000);
try {
  await sluby.assets.waitForReady(assetId, { pollInterval: 3000, timeout: 30 * 60_000 });
  uploadStatus.textContent = 'Ready.';
} catch (err) {
  // waitForReady throws a plain Error when processing failed; the
  // processing job carries the reason
  const job = await sluby.assets.processing(assetId).catch(() => null);
  throw job?.errorMessage ? new Error(`Processing failed: ${job.errorMessage}`) : err;
} finally {
  clearInterval(stagePoll);
}
```

`waitForReady` polls every 5 seconds for up to 10 minutes unless told otherwise, throws a `TimeoutError` when time runs out, and throws a plain `Error` when processing fails. `assets.processing` reports the stage (`queued`, `transcode`, `upload`, `finalize`, `completed`, `failed`), the overall percentage and the error message. Storing on Sia takes a few minutes even for a short clip (see [how long it takes](./quickstart#how-long-it-takes)).

## Play with hls.js

```js
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
```

`playback.streamUrl(id)` returns `{deliveryBaseUrl}/v1/stream/{id}/master.m3u8` for an asset id or a `pb_...` playback id without making a request. The gateway serves it to anyone while the asset is public, so a public asset plays with no key. A private asset (or a `signed` playback id) needs a signed URL (a `signed` playback id only gates its own stream URL; on a public asset the objects stay public, so use a private asset to keep a video private): pass one your server minted as `src`, or set `signed` to have the client mint it with `playback.getSignedUrl`, which needs a key. `playback.getUrl(id)` still exists for API clients that also want `posterUrl`, `durationMs`, `resolution` and `accessTier`; it needs the `read` scope.

The order of the checks follows the hls.js documentation: use hls.js wherever `Hls.isSupported()` (any browser with Media Source Extensions, which includes Safari on macOS and Safari's ManagedMediaSource), and set the URL as the video's `src` only where hls.js cannot run but the browser plays HLS itself, such as an iPhone without ManagedMediaSource. The hls.js README notes that Chrome reports native HLS support through `canPlayType` too, yet can fail on some streams, which is why the native check comes second.

hls.js recovers from non-fatal errors on its own. For fatal ones the example retries network errors 3 times and media errors twice, resetting the counters whenever a fragment buffers, which matches what `<SlubyPlayer>` does.

## Pick a rendition

Each video has several renditions. hls.js picks one by bandwidth; `hls.levels` lists them and setting `hls.currentLevel` pins one, with `-1` meaning adaptive again:

```js
hls.once(Hls.Events.MANIFEST_PARSED, () => {
  // -1 hands the choice back to hls.js's adaptive bitrate logic
  qualitySelect.add(new Option('Auto', '-1'));
  hls.levels.forEach((level, index) => {
    qualitySelect.add(new Option(`${level.height}p`, String(index)));
  });
  qualitySelect.disabled = false;
});
qualitySelect.onchange = () => {
  hls.currentLevel = Number(qualitySelect.value);
};
```

Setting `currentLevel` switches immediately and flushes the buffer. `hls.nextLevel` switches at the next fragment instead. On the native path the browser chooses the rendition and there is no list.

Outside the player, `client.assets.renditions(assetId)` (scope `read`) lists the renditions processing produced, tallest first, with each one's size, bitrate, segment count and the Sia objects holding its playlist and media.

## Direct-from-Sia playback

With a viewer identity in the client's `sia` config, `playAsset` above streams every playlist and segment from Sia hosts through `createSiaLoader` from `@sluby/player/hls`, and the gateway is out of the byte path. No API key is involved. Provision the identity once per deployment:

```sh
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Approve the URL it prints in your indexer account; it then prints the indexer URL, app id and app key. They are publishable: the viewer identity can resolve objects shared with it but has no access to your uploads.

`client.sia.prepare(assetId, { src: url })` loads the Sia SDK's WASM module (about 1.7 MB, only when `sia` is set), connects the viewer, and fetches the asset's share map: one short-lived `sia://` URL per object, valid for an hour by default and refreshed by the session when it nears expiry. With `{ src }` the map comes from the public `GET /v1/share/:id` on the same delivery base as `url`, carrying the `expires` and `sig` of `url` when it is signed, with no key and no cookie. The backend gates that endpoint exactly like the gateway (a public asset needs nothing, a private one the signature) and never mints shares that outlive the signature. Leave `{ src }` out and the session uses `GET /api/v1/playback/:id/share` instead, which needs the `read` scope.

Pass the same `{ src }` to `createSiaLoader`. The loader reads the object id out of each `/v1/objects/{id}` URL in the manifests and downloads that object, or the byte range hls.js asks for, straight from Sia. For the `/v1/stream/{id}/master.m3u8` URL itself, which names the asset rather than an object, it asks the session for the master object id from the share map.

The example lets a `prepare` failure surface as an error. `<SlubyPlayer>` instead falls back to the gateway and logs a console warning; do the same if you prefer playback over strictness. A custom loader cannot run on the native HLS path, so there the bytes always come through the gateway.

The viewer session talks to many Sia hosts at once, and some of them are always unreachable. Chrome logs each failed host connection in the console (for example `ERR_CONNECTION_REFUSED`, a QUIC idle timeout, or a WebTransport warning about too many pending sessions). Playback carries on as long as enough hosts answer, because every object is erasure-coded across many of them.

## Private videos

Upload with `accessTier: 'private'` and the gateway answers `403 This object requires a valid signed URL` to unsigned requests for the asset's objects. Play it from a signed URL: one your server minted with `playback.getSignedUrl(assetId, { expiresIn })` and handed to the page (`playAsset`'s `src`), or one the client mints itself when `signed` is set, which needs a key in the page. The URL carries an expiry and an HMAC signature over the manifest object and that expiry, and the gateway signs every playlist and segment URL inside the manifests it serves with the same expiry, so the single URL is enough for hls.js and for native playback. `expiresIn` is in seconds, defaults to an hour and is kept between a minute and six hours by the server; the answer's `expiresAt` is what was minted, and its `posterUrl` is the asset's first thumbnail signed the same way. The same signature unlocks the asset's share map on `/v1/share/:id` for direct-from-Sia playback; share maps for private assets are capped at one hour and never outlive the signature. Changing the asset's tier, or `POST /api/v1/playback/{id}/signed/revoke` with a `manage` key, voids every signed URL of the asset at once.

## Handle errors

REST calls throw typed errors that extend `SlubyError` (with `statusCode` and `responseBody`): `AuthenticationError` for 401 and 403, `NotFoundError` for 404, `RateLimitError` for 429 (with `retryAfter` in seconds), `TimeoutError` from `waitForReady`, and `SlubyError` itself for anything else, such as 409 when an asset is not ready to play.

```js
export function describeError(err) {
  if (err instanceof AuthenticationError) {
    // 401 is a missing or bad key, 403 a key without the scope this call needs
    return err.statusCode === 403
      ? `This API key lacks the scope for that call: ${err.message}`
      : `The API key was rejected: ${err.message}`;
  }
  if (err instanceof NotFoundError) {
    return `Not found: ${err.message}`;
  }
  if (err instanceof RateLimitError) {
    return `Rate limited, retry in ${err.retryAfter ?? '?'} seconds.`;
  }
  if (err instanceof SlubyError) {
    // TimeoutError lands here too, with statusCode 0
    return err.statusCode ? `API error ${err.statusCode}: ${err.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
```

Upload failures are tus-js-client errors (plain `Error`s) that reject the upload handle, and its `assetId` too when the asset was never created.

## Upload from a server

A server is the right place for a key with the `upload` scope. The same SDK runs in Node.js 20.16 or newer on the 20 line, or 22.3 or newer (its `engines` range):

```js
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SlubyClient } from '@sluby/sdk';

const [path, title] = process.argv.slice(2);
const apiKey = process.env.SLUBY_API_KEY;
if (!path || !apiKey) {
  console.error('usage: SLUBY_API_KEY=sluby_... node server/upload.mjs <file> [title]');
  process.exit(1);
}

const client = new SlubyClient({
  apiKey,
  baseUrl: process.env.SLUBY_BASE_URL ?? 'http://localhost:8080',
});

// in node the sdk uploads a Buffer, so the whole file is read into memory
const file = await readFile(path);
const upload = client.uploads.upload(file, {
  title: title ?? basename(path),
  accessTier: 'public',
  onProgress: (percent) => console.log(`uploaded ${percent}%`),
});

const assetId = await upload.assetId;
console.log(`asset ${assetId} created`);
await upload;

console.log('processing (transcode, then store on Sia)');
const asset = await client.assets.waitForReady(assetId, {
  pollInterval: 5000,
  timeout: 30 * 60_000,
});
const { playbackUrl } = await client.playback.getUrl(asset.id);
console.log(`ready: ${asset.resolution}, ${asset.durationMs} ms`);
console.log(`playback url: ${playbackUrl}`);
```

Run it from `examples/vanilla`:

```sh
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... node server/upload.mjs ./video.mp4 "My video"
```

In Node, `uploads.upload` takes a `Buffer`. tus-js-client's Node build accepts only a `Buffer` or a readable stream, and the SDK's signature is `File | Blob | Buffer`, so a file is read into memory in full before it is sent. Keep that in mind for very large files. A `Buffer` has no file name, so the upload's `filename` metadata is `video`; the asset's `title` is what you pass.

Waiting for the asset and reading its playback URL need the `read` scope as well, so this script uses a key with `upload` and `read` (the default for a new key).

## Mint signed URLs on your server

Playback needs no key in the browser, so the only thing a page cannot do alone is get a signed URL for a private asset. The example's `server/playback-server.mjs` holds a `read` key, answers `GET /api/v1/playback/:id/signed` for the assets it allows, and passes Sluby's answer through:

```js
// GET /api/v1/playback/:id/signed, what client.playback.getSignedUrl calls
const SIGNED_PATH = /^\/api\/v1\/playback\/([^/]+)\/signed$/;

/**
 * Whether this viewer may watch the asset. A real app checks its own session
 * here (is the user signed in, did they buy this video); the example allows a
 * fixed list.
 *
 * @param {import('node:http').IncomingMessage} _req
 * @param {string} assetId
 */
function canWatch(_req, assetId) {
  return playable.has(assetId);
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && appOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = req.method === 'GET' ? SIGNED_PATH.exec(url.pathname) : null;
  if (!match || !canWatch(req, decodeURIComponent(match[1]))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // forward only the lifetime parameter, the rest of the query is not ours
  const expiresIn = url.searchParams.get('expires_in');
  const query = expiresIn ? `?expires_in=${encodeURIComponent(expiresIn)}` : '';
  try {
    const upstream = await fetch(`${slubyUrl}${url.pathname}${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    // pass the answer through unchanged: the browser sdk parses sluby's own json
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await upstream.text());
  } catch (err) {
    console.error('sluby request failed', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Sluby' }));
  }
}).listen(port, () => {
  console.log(`signing server on http://localhost:${port}, forwarding to ${slubyUrl}`);
});
```

```sh
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... \
PLAYABLE_ASSET_IDS=<asset id> APP_ORIGINS=http://localhost:5181 \
  node server/playback-server.mjs
```

The browser then builds its client with no key, the base URL pointing at that server and the delivery URL at Sluby, because the signed URL that comes back is a URL on the gateway:

```js
new SlubyClient({
  baseUrl: 'http://localhost:8787', // your signing server
  deliveryBaseUrl: 'http://localhost:8080', // the sluby gateway
  sia: { indexerUrl, appId, appKey }, // optional
});
```

`playAsset` with `signed` set works unchanged on that client, direct from Sia included: the share map comes from Sluby's public `/v1/share/:id` with the signed URL's signature, not from your server. The SDK sends its requests with only an `Accept` header, so the browser makes simple CORS requests without a preflight. In your app this endpoint would usually live on the same origin as the page.

The server can also call `getSignedUrl(id)` while rendering the page and put the URL in it, for `playAsset`'s `src`.

## Manage keys, webhooks and playback IDs

The client also wraps the account's management endpoints. Run these on your server with a key that has the scope each needs (`manage`, except where noted):

```js
// API keys: one page at a time, newest first
const page = await client.keys.list({ limit: 50 });
const next = page.hasMore ? await client.keys.list({ limit: 50, cursor: page.nextCursor }) : null;
const created = await client.keys.create({ name: 'ci', scopes: ['upload', 'read'] });
// created.key is the secret, returned only here
const rotated = await client.keys.rotate(created.id, { gracePeriodSeconds: 3600 });
await client.keys.revoke(rotated.id);

// webhook endpoints
const endpoint = await client.webhookEndpoints.create({
  url: 'https://app.example.com/hooks/sluby',
  events: ['asset.ready', 'asset.errored'],
});
// endpoint.secret is returned only here; verify deliveries with client.webhooks.verifyRequest
const outcome = await client.webhookEndpoints.test(endpoint.id);
const attempts = await client.webhookEndpoints.deliveries(endpoint.id, { limit: 20 });
await client.webhookEndpoints.delete(endpoint.id);

// playback IDs (listing needs read)
const pb = await client.playbackIds.create(assetId, { policy: 'signed', name: 'embed' });
const ids = await client.playbackIds.list(assetId);
await client.playbackIds.delete(pb.playbackId);

// library totals for the account (read)
const stats = await client.assets.stats();
```

`keys.rotate` on a key that was already rotated rejects with a `ConflictError`; rotate its replacement. An ID from another account rejects with a `NotFoundError`, the same as one that does not exist.

## Run the example

```sh
npm install
npm run build:sdk
npm run build:player
cd examples/vanilla
cp .env.example .env   # optional: defaults for the form fields
npm run dev
```

Open [http://localhost:5181](http://localhost:5181), enter the API base URL and a key, upload a video, and press **Play** when it is ready. Playing needs no key: with the key field empty, **Play** works for a public asset, and for a private one with a signed URL in the playback URL field. `npm run upload -- ./video.mp4` and `npm run playback-server` run the two server scripts, with the environment variables shown above.

# @sluby/sdk

TypeScript SDK for [Sluby](https://github.com/justmert/Sluby), decentralized video
infrastructure on Sia. Typed asset management, resumable TUS uploads, and
playback URL retrieval, for the browser and Node.

## Install

```bash
npm install @sluby/sdk
```

## Quickstart

```ts
import { SlubyClient } from '@sluby/sdk';

const client = new SlubyClient({
  apiKey: 'sluby_...',
  baseUrl: 'https://api.sluby.app',
  // Optional: where the browser fetches HLS bytes from directly (an object
  // gateway or an nginx cache). Defaults to baseUrl.
  deliveryBaseUrl: 'https://cache.sluby.app',
});

// 1. Upload a video via resumable TUS. The asset is created as the upload
//    begins; read `assetId` to start polling.
const upload = client.uploads.upload(file, {
  title: 'My Video',
  description: 'Demo upload',
  accessTier: 'public',
  onProgress: (percent) => console.log(`${percent}%`),
});
// upload.pause(); upload.resume(); upload.abort();
const videoAssetId = await upload.assetId;
await upload;

// 2. Wait for processing to finish.
const asset = await client.assets.waitForReady(videoAssetId);

// 3. Get an absolute playback URL to hand to a player.
const { playbackUrl } = await client.playback.getUrl(asset.id);
```

### Cookie session (same-origin browser apps)

A browser app served from the same origin as the API (the Studio does this)
can skip the API key. Requests and TUS uploads then carry the signed-in
session cookie:

```ts
const client = new SlubyClient({ baseUrl: window.location.origin });
```

If the cookie session has to cross origins, pass `credentials: 'include'` and
allow credentialed CORS for your origin on the API.

## API

- `client.uploads`: `upload()` (resumable TUS; returns an awaitable handle with
  `pause()` / `resume()` / `abort()` / `isPaused` plus an `assetId` promise),
  `getStatus()`, `cancel()`.
- `client.assets`: `list()` (with `search`, `sort`, `order` and cursor paging), `get()`, `update()`, `delete()`, `waitForReady()`, `processing()` (the processing job with its stage, progress and log), `retry()` for a failed asset.
- `client.playback`: `getUrl()` and `getSignedUrl()`, both returning an absolute
  URL (`playbackUrl` / `signedUrl`) resolved against the delivery base, plus the
  raw server path (`playbackPath` / `signedPath`). `streamUrl(id)` returns the
  public master URL (`/v1/stream/{id}/master.m3u8`) without a request or a key.
- `client.webhooks`: signature verification and event parsing.
- `client.sia`: present when the client is created with a `sia` viewer config; `@sluby/player` uses it to stream straight from Sia hosts instead of the gateway. Given the playback URL (`prepare(id, { src })`), it fetches the share map from the public `/v1/share/:id` with that URL's signature and no credentials, so a page without an API key can play direct from Sia.
- `client.resolveDeliveryUrl(path)`: turn a server-relative delivery path into an
  absolute URL.

Errors are typed: `AuthenticationError` (401/403), `NotFoundError` (404),
`RateLimitError` (429, with `retryAfter`), `TimeoutError`, and the base
`SlubyError` (with `statusCode` and `responseBody`).

## TypeScript and CommonJS

The package ships ESM and CommonJS builds with matching type declarations. One case needs `skipLibCheck: true`: a CommonJS TypeScript project using `moduleResolution: node16` or `nodenext`. The types of `@siafoundation/sia-storage`, which this SDK builds on, are declared as ESM for its CommonJS entry, so TypeScript reports TS1479 inside that package's declarations. ESM projects and bundler resolution are not affected.

## Pairs with

[`@sluby/player`](https://www.npmjs.com/package/@sluby/player), a React player
that accepts a `SlubyClient` and an `assetId` directly.

## License

Apache-2.0

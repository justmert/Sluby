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
// abort() after this point does nothing: a finished upload is never deleted

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
  `pause()` / `resume()` / `abort()` / `isPaused` plus `assetId` and `uploadId` promises),
  `getStatus(uploadId)`, `cancel(uploadId)`.
- `client.assets`: `list()` (with `search`, `sort`, `order`, and paging by `page` or by passing each page's `nextCursor` back as `cursor`), `get()`, `update()`, `delete()`, `waitForReady()`, `processing()` (the processing job with its stage, progress and log), `retry()` for a failed asset.
- `client.playback`: `getUrl()` and `getSignedUrl()`, both returning an absolute
  URL (`playbackUrl` / `signedUrl`) resolved against the delivery base, plus the
  raw server path (`playbackPath` / `signedPath`). `streamUrl(id)` returns the
  public master URL (`/v1/stream/{id}/master.m3u8`) without a request or a key.
- `client.webhooks`: `verifyRequest(rawBody, headers, secret)` (and `verifyRequestAsync` for edge runtimes) checks the `X-Sluby-Signature-V1` header against `X-Sluby-Timestamp` and refuses a request more than five minutes old (`toleranceSeconds`); `headers` is a Fetch `Headers` or Node's `req.headers` (types `WebhookHeaders`, `VerifyRequestOptions`). `parseEvent()` returns the event with its `id`, the same on every retry. `verifySignature()` checks the deprecated body-only `X-Sluby-Signature`.
- `client.sia`: present when the client is created with a `sia` viewer config; `@sluby/player` uses it to stream straight from Sia hosts instead of the gateway. Given the playback URL (`prepare(id, { src })`), it fetches the share map from the public `/v1/share/:id` with that URL's signature and no credentials, so a page without an API key can play direct from Sia.
- `client.resolveDeliveryUrl(path)`: turn a server-relative delivery path into an
  absolute URL.

Errors are typed, and every one is a `SlubyError` (with `statusCode`, `responseBody` and, when there is one, the underlying error as `cause`): `ValidationError` (400/422), `AuthenticationError` (401), `PermissionError` (403, such as a key without the needed scope), `NotFoundError` (404/410), `ConflictError` (409, such as playback of an asset that is still processing), `RateLimitError` (429, with `retryAfter`), `TimeoutError`, `AbortError` (a cancelled call or upload; its `name` is `'AbortError'`) and `ProcessingFailedError` (from `waitForReady`, with the failed `asset`). Upload failures are mapped the same way. A request that never got a response rejects with the platform's own `fetch` error (a `TypeError`).

### Uploads

Each `upload()` creates a new asset. In the browser, an unfinished upload of the same file with the same title, description, tier and key, interrupted on an earlier page load, is resumed instead; pass `resume: false` to always start over. A finished upload is never resumed. `abort()` cancels an unfinished upload and discards its asset; once the upload has finished it does nothing, so cleanup code can always call it. In the browser `upload()` takes a `File` or `Blob`; in Node a `Buffer`, `Uint8Array` or `Blob` (such as one from `fs.openAsBlob`), but not a stream.

### Cancelling and timeouts

Every request method takes `{ signal }` (an `AbortSignal`), and `upload()` takes `signal` in its options. `waitForReady(id, { signal })` stops polling when it fires, which is what a React effect's cleanup should do. `timeoutMs` in the client config bounds every API request, body included, and rejects with a `TimeoutError`; it is unset by default.

## Direct from Sia in a bundled app

`client.sia` loads `@siafoundation/sia-storage`, a WebAssembly package, on first use. Vite production builds work as they are, but `vite dev` needs the package left out of dependency pre-bundling (or its `siaStorage()` Vite plugin), or the WASM file cannot be found and the player falls back to the gateway with a warning:

```js
// vite.config.js
export default defineConfig({
  optimizeDeps: { exclude: ['@siafoundation/sia-storage'] },
});
```

Webpack needs `experiments: { asyncWebAssembly: true, topLevelAwait: true }`. With Rollup or esbuild, copy `node_modules/@siafoundation/sia-storage/wasm/sia_storage_wasm_bg.wasm` into the output directory. See the sia-storage README for Next.js and other setups.

`client.sia` caches resolved objects (up to `SiaSession.MAX_CACHED_OBJECTS`, least recently used dropped first); call `client.sia.dispose()` to free them and the WASM SDK when the page no longer plays video. A share map fetched for a signed playback URL ends when that URL's signature does, so a page playing past it needs a newly signed URL (the player's `refreshSrc`).

## TypeScript and CommonJS

The package ships ESM and CommonJS builds with matching type declarations. They need neither `@types/node` nor `skipLibCheck`: they type-check with `skipLibCheck: false` under bundler, `node16` ESM and `node16` CommonJS resolution with only the `es2022` and `dom` libs. The package supports Node 20.16+ and 22.3+ (see `engines`).

## Pairs with

[`@sluby/player`](https://www.npmjs.com/package/@sluby/player), a React player
that accepts a `SlubyClient` and an `assetId` directly.

## License

Apache-2.0

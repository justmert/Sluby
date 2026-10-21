---
name: sluby
description: Build on Sluby, the self-hosted video platform that stores media on Sia. Upload videos, wait for processing, manage assets, play them public or signed, verify webhooks.
license: Apache-2.0
---

# Sluby

Sluby is a self-hosted video platform. A Sluby server takes video uploads over tus, transcodes them to HLS, stores the result on the Sia network, and serves playback URLs, a watch page and signed webhooks. You talk to it with the REST API under `/api/v1`, the TypeScript SDK `@sluby/sdk`, and the React player `@sluby/player`.

Use this skill when code uploads videos to a Sluby server, reads or edits its library, plays its videos, shares private videos, or receives its webhooks.

## Before you write code

1. Ask for the server's address if you do not have it. Every URL in this skill is relative to it, written here as `https://sluby.example.com`.
2. Read the server's own API description when you need a field or endpoint that this skill does not show. It is public, no key needed:
   - `https://sluby.example.com/api/v1/openapi.json`: the OpenAPI document of that server.
   - `https://sluby.example.com/api/v1/docs`: the same document as an interactive reference.
   - `https://raw.githubusercontent.com/justmert/Sluby/main/docs/public/openapi.json`: the document for the Sluby source on `main`, for when the server is out of reach. Prefer the server's own document: it matches the version that server runs.
3. Get an API key. A person creates it in the Studio under **Developers**, **API keys**, or code with a `manage` key calls `POST /api/v1/keys`. The raw key starts with `sluby_`, and the server returns it only once, at creation.

## Rules that prevent the common mistakes

- **Keep API keys on the server.** A key is a bearer secret: whoever holds it acts within its scopes. Never put one in browser code, a mobile app, or a repository. Read it from an environment variable such as `SLUBY_API_KEY`.
- **Pick the smallest scopes.** A key has one or more of `upload`, `read` and `manage`. `POST /api/v1/keys` gives a new key `upload` and `read` unless the request lists others. See [references/rest-api.md](references/rest-api.md) for what each scope allows.
- **Respect the rate limit.** Each key has a requests-per-minute limit, set at creation (`POST /api/v1/keys` uses 100 when the request sets none). The server caps it at its own maximum. Over it the API answers `429` with a `Retry-After` header; the SDK throws a `RateLimitError` whose `retryAfter` is in seconds. Wait that long, then retry.
- **Private videos need signed URLs.** A video whose `accessTier` is `private` plays only through a signed URL that your server mints with the key. Public videos play without any key.
- **Wait for `ready`.** The endpoints under `/api/v1/playback` answer `409` until the asset's status is `ready`.
- **Verify webhooks.** Check the `X-Sluby-Signature-V1` header against the raw request body before you trust an event.

## Install

```sh
npm install @sluby/sdk          # 0.2.1: server code, uploads, library, signed URLs, webhooks
npm install @sluby/player       # 0.3.0: React player (react and react-dom 18 or 19)
```

`@sluby/sdk` runs in browsers and on Node.js 20.16 or a later 20.x release, or Node.js 22.3 or later.

## The main flow with the SDK

```ts
import { openAsBlob } from 'node:fs';
import { ProcessingFailedError, SlubyClient } from '@sluby/sdk';

// server-side code: the API key never reaches a browser
const sluby = new SlubyClient({
  baseUrl: process.env.SLUBY_URL!, // for example https://sluby.example.com
  apiKey: process.env.SLUBY_API_KEY!,
});

const file = await openAsBlob('talk.mp4', { type: 'video/mp4' });
const upload = sluby.uploads.upload(file, {
  title: 'Conference talk',
  description: 'Recorded on stage',
  accessTier: 'private',
  onProgress: (percent) => console.log(`uploaded ${percent}%`),
});

const assetId = await upload.assetId; // resolves once the server has created the upload
await upload; // resolves once every byte is on the server

try {
  const asset = await sluby.assets.waitForReady(assetId, { timeout: 30 * 60_000 });
  console.log(asset.id, asset.status, asset.durationMs);
} catch (err) {
  if (err instanceof ProcessingFailedError) {
    const job = await sluby.assets.processing(assetId);
    console.error(job.stage, job.errorMessage, job.retryable);
  }
  throw err;
}
```

- `baseUrl` is the server's origin, not `/api/v1`. The SDK adds the paths.
- `uploads.upload` takes a `Blob` or `File`, or a `Uint8Array` (a Node `Buffer` is one). It does not take Node streams.
- `waitForReady` polls every 5 seconds and gives up after 10 minutes unless you pass `pollInterval` and `timeout` in milliseconds. It throws `ProcessingFailedError` when the asset ends `failed` and `TimeoutError` when time runs out.

Details on uploads, including uploading with any tus client or with curl: [references/uploads.md](references/uploads.md).

## Manage the library

| Task                            | SDK call                                                                          | Scope    |
| ------------------------------- | --------------------------------------------------------------------------------- | -------- |
| List assets (filters, cursor)   | `sluby.assets.list({ status, accessTier, search, limit, cursor })`                | `read`   |
| Get one asset                   | `sluby.assets.get(id)`                                                            | `read`   |
| Rename, describe, change tier   | `sluby.assets.update(id, { title, description, accessTier }, { ifMatch: asset })` | `manage` |
| Processing stage, error and log | `sluby.assets.processing(id)`                                                     | `read`   |
| Retry failed processing         | `sluby.assets.retry(id)`                                                          | `manage` |
| Delete                          | `sluby.assets.delete(id)`                                                         | `manage` |

The REST endpoints, paging rules, errors and ETags are in [references/rest-api.md](references/rest-api.md).

## Play a video

- **Public video, any page:** `sluby.playback.streamUrl(id)` builds the HLS URL `https://sluby.example.com/v1/stream/<id>/master.m3u8` without a request or a key.
- **Private video:** your server calls `sluby.playback.getSignedUrl(id, { expiresIn: 3600 })` and hands `signedUrl` to the page. Signed URLs last 60 to 21600 seconds (3600 by default).
- **Watch page:** `https://sluby.example.com/watch/<id>` is a ready-made player page you can link to or put in an `<iframe>`.
- **Playback ids:** `sluby.playbackIds.create(id)` makes a revocable `pb_...` handle you use in place of the asset id.

React components, the iframe code, signed watch pages and playback ids: [references/playback.md](references/playback.md).

## Webhooks

Register an endpoint with `sluby.webhookEndpoints.create({ url, events })` (needs `manage`), store the `secret` it returns once, and check every request with `sluby.webhooks.verifyRequest(rawBody, headers, secret)` (or `new WebhookManager().verifyRequest(...)`, which needs no client). Events, retries and a receiver: [references/webhooks.md](references/webhooks.md).

## Errors the SDK throws

| Class                   | When                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `AuthenticationError`   | 401: key missing, wrong, revoked or expired                                           |
| `PermissionError`       | 403: the key lacks the scope, or a signed URL is invalid or expired                   |
| `NotFoundError`         | 404 or 410                                                                            |
| `ConflictError`         | 409 (for example playback before `ready`), or 412 from `assets.update` with `ifMatch` |
| `ValidationError`       | 400 or 422                                                                            |
| `RateLimitError`        | 429, with `retryAfter` in seconds                                                     |
| `TimeoutError`          | `timeoutMs` of the client or `timeout` of `waitForReady` ran out                      |
| `AbortError`            | your `AbortSignal` fired, or you called `abort()` on an upload                        |
| `ProcessingFailedError` | `waitForReady` saw the asset end `failed`; `asset` holds it                           |

All of them extend `SlubyError`, which carries `statusCode` and `responseBody`. Any other HTTP status (for example `413` or `415` from an upload, or a `5xx`) arrives as a plain `SlubyError`. A network failure on a REST call rejects with the platform's own error from `fetch` (a `TypeError`), not a `SlubyError`.

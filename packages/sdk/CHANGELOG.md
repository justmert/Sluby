# Changelog

## Unreleased

### Fixed

- `PaginatedResponse.page` is typed `number | null`, since the API answers `null` for a page fetched with a cursor. Code that does arithmetic on `page` after a cursor request needs a null check.

## 0.2.1 (2026-10-21)

### Changed

- Requires `@siafoundation/sia-storage` 0.1.5 (was 0.1.1 or later).

## 0.2.0 (2026-10-08)

### Breaking

- A 403 rejects with the new `PermissionError` instead of `AuthenticationError`, which now means 401 only. Migration: catch `PermissionError` where you handled a missing scope or a refused signed URL as an `AuthenticationError`.
- 400 and 422 reject with `ValidationError`, 409 with `ConflictError` and 410 with `NotFoundError` (its `statusCode` is 410) instead of a bare `SlubyError`. All are still `SlubyError`s, so `instanceof SlubyError` checks keep working.
- Upload failures reject with a `SlubyError` (the typed class for the HTTP status, with the tus error as `cause`) instead of tus-js-client's `DetailedError`, and `abort()` rejects with the new `AbortError` instead of a plain `Error('Upload aborted')`. Migration: read `statusCode` and `message` from the error; the tus error is on `cause`.
- `assets.waitForReady()` rejects with the new `ProcessingFailedError`, which carries the failed `asset`, instead of a plain `Error` whose message said the asset failed. It also reads the asset at least once, even with `timeout: 0`.
- `SiaSession.connect()` resolves to nothing instead of the WASM `Sdk`, and `resolveObjectId()` resolves to an opaque `SiaObject` instead of sia-storage's `PinnedObject`, so the published types no longer import `@siafoundation/sia-storage`. Migration: pass the `SiaObject` to `download()` as before; code that used the `Sdk` directly should create its own with sia-storage.
- `SiaSession` keys resolved objects by asset and object only, so the same object resolved through two share maps is one cached handle, and a session built directly (not through `SlubyClient`) without `transport.resolveDeliveryUrl` rejects a relative `src` with an error that says so instead of failing on `new URL`.
- `publicShareMapUrl(id, src)` and the session ask for the id a `/v1/stream/{id}/master.m3u8` URL names (the one its signature was issued for), not the `assetId` argument; for `/v1/objects/{id}` URLs `assetId` is still used.
- `WebhookEndpoint` and `ApiKey` are now what `webhookEndpoints.list()` and `keys.list()` return, where before no method returned them. `WebhookEndpoint.events` is `WebhookEventName[]` instead of `string[]`, `ApiKey.scopes` is `ApiKeyScope[]` (`'upload' | 'read' | 'manage'`) instead of `string[]`, and `ApiKey` gains `expiresAt` (set while a rotated-out key is in its grace period). Migration: code that builds these objects itself must use the narrower types and set `expiresAt`.
- `VideoAsset` gains `playCount` and `lastPlayedAt`, `ProcessingJob` gains `retryable`, `ApiKey` gains `prefix` and `lastUsedAt`, `WebhookEndpoint` gains `lastDeliveryAt` and `lastDeliveryOk`, and `WebhookDelivery` gains `payload` and `manual`. `keys.list()` resolves an `ApiKeyPage`, a `CursorPage<ApiKey>` with `limits`. Migration: code that builds these objects itself (test fixtures, say) must set the new fields.
- `upload()` takes `Blob | Uint8Array` (`UploadInput`) instead of `File | Blob | Buffer`, so the published types no longer need `@types/node`. A `File` is a `Blob` and a `Buffer` is a `Uint8Array`, so existing calls compile unchanged.
- Corrected types: `VideoAsset.durationMs` and `resolution` and `PlaybackInfo.durationMs` and `resolution` can be `null`, `UploadSession.videoAssetId` can be `null` and its `status` is the `UploadSessionStatus` union, and `assets.retry()` resolves `{ stage: RetryStage }` (`'transcode' | 'upload-segments'`). Migration: handle `null` where these fields are read; code that switched on a string `status` may need the union's cases.
- `playback.getSignedUrl()` throws a `RangeError` for an `expiresIn` that is not a positive whole number; the backend read `0` or a fraction as "use the default".
- `engines` requires Node 20.16+ or 22.3+, the versions with `process.getBuiltinModule`, which `webhooks.verifySignature()` needs.

### Added

- `client.keys`: `list({ limit, cursor })` pages the account's API keys by cursor (`CursorPage<ApiKey>` with `hasMore` and `nextCursor`), `create()` returns the key with its secret (`CreatedApiKey`), `rotate(id, { gracePeriodSeconds })` returns the replacement (`RotatedApiKey`) and `revoke(id)` deletes a key.
- `client.webhookEndpoints`: `list()`, `create({ url, events })` (with the signing secret, `CreatedWebhookEndpoint`), `delete(id)`, `test(id)` (`WebhookTestResult`) and `deliveries(id, { limit })` (`WebhookDelivery[]`).
- `keys.update(id, { name })` renames a key. Listed keys carry `prefix` (the first 12 characters, `sluby_` and 6 more, null for keys made before it was stored) and `lastUsedAt` (to the minute), and `keys.list()` returns the server's `limits` (`maxKeys`, `maxRateLimit`) to check a new key against.
- `webhookEndpoints.get(id)`, `update(id, { url, events, isActive })` (`isActive: false` pauses an endpoint, `true` resumes it), `rotateSecret(id)` (`{ id, secret }`, the old secret stops at once) and `redeliver(id, deliveryId)` (`{ deliveryId }`, resends the stored payload with the same event id; a paused endpoint rejects with `ConflictError`). Endpoints carry `lastDeliveryAt` and `lastDeliveryOk`, and deliveries `payload` and `manual`.
- `assets.update(id, data, { ifMatch })` sends `If-Match` with the asset as read (or its ETag), so the edit applies only if nobody changed the asset since; otherwise it rejects with a `ConflictError` whose `statusCode` is 412 and whose `current` is the asset as it is now. `assetEtag(asset)` builds the ETag from `updatedAt`.
- `assets.usage({ days })` returns plays per UTC day for the last 1 to 90 days (`UsageReport`), and assets carry `playCount` and `lastPlayedAt`. A play is a player load the server saw: the gateway serving the master playlist, or the share map a direct-from-Sia player needs.
- `assets.processing(id)` returns `retryable`: whether `assets.retry()` can start a new run (false for a file that is not a readable video, or when nothing is left to start from).
- `client.sessions`: `list()` (`StudioSession[]`, with `lastSeenAt`), `revoke(id)` and `revokeAll()`, for an app signed in with a browser session; an API key gets an `AuthenticationError`.
- `SiaSession` marks the refresh of a share map it already holds with `renew=1`, so a long watch counts as one play. `getShareMap(id, source, { renew })` takes it too.
- `client.reconciliation`: `latest()` returns the latest storage check (`ReconciliationReport`, `scope` `account` or `deployment`) with `missingObjects`, each missing object id with the `videoAssetId` and `title` of its video (null when no live video holds it), and `run()` queues a check (platform identity and operators only).
- `ConflictError` also covers 412 Precondition Failed, with `current` set by `assets.update`.
- `client.playbackIds`: `list(assetId)`, `create(assetId, { policy, name })` and `delete(playbackId)` (`PlaybackId`).
- `assets.renditions(id)` returns the asset's renditions (`Rendition[]`) and `assets.stats()` the account's library totals (`AssetStats`).
- `playback.getSignedUrl()` returns `posterUrl`, the asset's first thumbnail signed like the manifest (null when it has none, or from a backend before this change), so a private asset can show a poster. The backend keeps `expiresIn` between 60 and 21600 seconds, and a signed URL stops working early when the asset's tier changes or its signed URLs are revoked (`POST /api/v1/playback/{id}/signed/revoke`).
- `webhooks.verifyRequest(rawBody, headers, secret, { toleranceSeconds })` and `webhooks.verifyRequestAsync(...)` verify the new `X-Sluby-Signature-V1` header, the hex HMAC-SHA256 of `<X-Sluby-Timestamp>.<raw body>`, and refuse a timestamp more than `toleranceSeconds` (default 300) from now, so a captured request cannot be replayed. `headers` is a Fetch `Headers` or Node's `req.headers`.
- `webhooks.parseEvent()` returns the event's `id` (also on `WebhookEvent.id`), which stays the same on every retry of the event, so a receiver can drop one it already handled. Events from backends before this change have no `id`.
- `playback.streamUrl(idOrPlaybackId)` returns the absolute public master URL (`/v1/stream/{id}/master.m3u8`) on the delivery base without a request.
- `SiaSession` methods take an optional `{ src }`, the gateway playback URL being played. With it the share map comes from the public `GET /v1/share/:id` on the same delivery base, carrying the URL's `expires` and `sig`, with no `Authorization` header and no cookies, so direct-from-Sia playback needs no API key. Without it the authenticated `GET /api/v1/playback/:id/share` is used as before.
- `SiaSession.masterObjectId(id, source)` names the master object from the share map, so a `/v1/stream/...` URL can be played direct from Sia.
- `publicShareMapUrl(id, src)` and the `SiaShareSource` and `SiaSessionTransport` types are exported.
- Direct-from-Sia playback: `SlubyConfig.sia` takes a viewer identity (`SiaViewerConfig`), and `SiaSession` fetches an asset's share map from the backend and downloads objects straight from Sia hosts through `@siafoundation/sia-storage`.
- `assets.processing(id)` returns the processing job with its stage, progress, retry count and log, and `assets.retry(id)` restarts a failed one.
- `assets.list()` takes `search`, `sort` (`created_at`, `title`, `duration`, `size`) and `order`.
- Cookie sessions: `apiKey` is optional and `credentials` is passed to `fetch`, so a same-origin app signed in to the Studio can use the client without a key.
- `LICENSE` and `NOTICE` ship in the package.
- Upload handles have an `uploadId` promise, the id `uploads.getStatus()` and `uploads.cancel()` take (the last segment of the tus upload URL).
- `upload()` takes `resume: false` to never resume a previous upload, and `signal` to abort it.
- Every request method takes `{ signal }` (an `AbortSignal`), `waitForReady()` takes `signal` and stops polling when it fires, and `SlubyConfig.timeoutMs` bounds every API request, body included, with a `TimeoutError`.
- Cursor paging: `assets.list()` takes `cursor`, and pages have `nextCursor` and `hasMore`.
- `PermissionError`, `ConflictError`, `ValidationError`, `AbortError` and `ProcessingFailedError`, and `SlubyError` takes a `cause`.
- `SiaSession.dispose()` frees every resolved object and the WASM SDK; the session reconnects on next use. Resolved objects are capped at `SiaSession.MAX_CACHED_OBJECTS` (64), least recently used freed first.
- `upload()` accepts a `Blob` in Node (as `fs.openAsBlob` returns, read chunk by chunk) and a plain `Uint8Array` everywhere.
- Types: `RequestOptions`, `RetryStage`, `UploadSessionStatus`, `UploadInput`, `SiaObject` and `WebhookEventName`.

### Changed

- `webhooks.verifySignature()` and `verifySignatureAsync()` are unchanged but deprecated for webhooks: the `X-Sluby-Signature` header they check (the HMAC of the body alone) binds no time, so a captured request verifies forever. The backend keeps sending it next to the v1 headers so existing receivers work; move them to `verifyRequest`.
- `@siafoundation/sia-storage` is a new dependency, loaded only when a `sia` config is used.
- The `UploadManager` constructor takes `(fetchFn, { apiKey, baseUrl, credentials })` instead of `(fetchFn, apiKey, baseUrl)`. `SlubyClient` users are not affected.

### Fixed

- Uploading the same file again in a browser created no asset: tus-js-client resumed the finished first upload from localStorage, reported success without sending anything, and `assetId` resolved to the old asset (even a deleted one) with the old title. Finished uploads are now forgotten, the stored fingerprint includes the key and the metadata, and an upload the server has in full (or no longer has) is never resumed.
- `upload.abort()` after the upload finished sent a tus DELETE, and the backend discarded the asset. It now does nothing once the upload has finished; `pause()` likewise.
- A failed previous-upload lookup (broken localStorage) left the handle pending forever; it now rejects the handle and calls `onError`.
- Pausing before the upload started and then resuming skipped the resume of a previous upload.
- `webhooks.verifySignatureAsync()` rejected an uppercase hex signature that `verifySignature()` accepted.
- The ESM build's `require` fallback in `verifySignature()`, which bundlers turn into a throw, is gone; it uses `process.getBuiltinModule` only.
- A 2xx response whose body is not JSON rejects with a `SlubyError` carrying the text instead of a bare `SyntaxError`.
- `SiaSession` shares one share map request between concurrent resolves, rejects a map without a valid `expires_at` instead of refetching it on every call, no longer refetches on every resolve a map that is inside the refresh margin but capped at a signed URL's expiry, and only re-mints the map after a failed resolve when the map is near or past its expiry.
- `SiaSession.resolveObjectId()` rejects instead of throwing synchronously for a bad `src`, and rejects with a `NotFoundError` when the map has no share URL for the object.
- `webhooks.verifySignature()` works from the ESM build. It used `require`, which ESM does not have, so it threw on Node; it now loads `node:crypto` through `process.getBuiltinModule`.
- `upload.abort()` now rejects the upload handle (it used to stay pending forever), and aborting before the upload starts no longer uploads the file anyway.
- `RateLimitError.retryAfter` reads a `Retry-After` given as an HTTP date instead of returning `NaN`.
- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.
- An error response whose body is HTML (a proxy's `502 Bad Gateway` page, say) or several lines of text no longer becomes the error `message`; the message falls back to the status text, and the body stays on `responseBody`.

## 0.1.0

First release.

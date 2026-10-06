# Changelog

## Unreleased

### Added

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

### Changed

- `webhooks.verifySignature()` and `verifySignatureAsync()` are unchanged but deprecated for webhooks: the `X-Sluby-Signature` header they check (the HMAC of the body alone) binds no time, so a captured request verifies forever. The backend keeps sending it next to the v1 headers so existing receivers work; move them to `verifyRequest`.
- `@siafoundation/sia-storage` is a new dependency, loaded only when a `sia` config is used.
- The `UploadManager` constructor takes `(fetchFn, { apiKey, baseUrl, credentials })` instead of `(fetchFn, apiKey, baseUrl)`. `SlubyClient` users are not affected.

### Fixed

- `webhooks.verifySignature()` works from the ESM build. It used `require`, which ESM does not have, so it threw on Node; it now loads `node:crypto` through `process.getBuiltinModule`.
- `upload.abort()` now rejects the upload handle (it used to stay pending forever), and aborting before the upload starts no longer uploads the file anyway.
- `RateLimitError.retryAfter` reads a `Retry-After` given as an HTTP date instead of returning `NaN`.
- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.

## 0.1.0

First release.

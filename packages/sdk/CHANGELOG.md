# Changelog

## Unreleased

### Added

- Direct-from-Sia playback: `SlubyConfig.sia` takes a viewer identity (`SiaViewerConfig`), and `SiaSession` fetches an asset's share map from the backend and downloads objects straight from Sia hosts through `@siafoundation/sia-storage`.
- `assets.processing(id)` returns the processing job with its stage, progress, retry count and log, and `assets.retry(id)` restarts a failed one.
- `assets.list()` takes `search`, `sort` (`created_at`, `title`, `duration`, `size`) and `order`.
- Cookie sessions: `apiKey` is optional and `credentials` is passed to `fetch`, so a same-origin app signed in to the Studio can use the client without a key.
- `LICENSE` and `NOTICE` ship in the package.

### Changed

- `@siafoundation/sia-storage` is a new dependency, loaded only when a `sia` config is used.
- The `UploadManager` constructor takes `(fetchFn, { apiKey, baseUrl, credentials })` instead of `(fetchFn, apiKey, baseUrl)`. `SlubyClient` users are not affected.

### Fixed

- `webhooks.verifySignature()` works from the ESM build. It used `require`, which ESM does not have, so it threw on Node; it now loads `node:crypto` through `process.getBuiltinModule`.
- `upload.abort()` now rejects the upload handle (it used to stay pending forever), and aborting before the upload starts no longer uploads the file anyway.
- `RateLimitError.retryAfter` reads a `Retry-After` given as an HTTP date instead of returning `NaN`.
- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.

## 0.1.0

First release.

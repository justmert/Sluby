# Changelog

## Unreleased

### Added

- Keyless direct-from-Sia playback: with `src`, `assetId` and a `client` that has a Sia session, the player streams `src` from Sia using the public share map for it (`GET /v1/share/:id`, with the URL's signature when it is signed), so a public page needs no API key. It does not start a gateway load before the session is ready, and Safari's native HLS and session failures still fall back to the gateway.
- `createSiaLoader(session, assetId, { src })` does the same for plain hls.js apps through `@sluby/player/hls`, and loads a `/v1/stream/{id}/master.m3u8` URL through the session's master object id.
- `SiaPlaybackSession` takes an optional `source` on `prepare` and `resolveObjectId` and an optional `masterObjectId`; sessions written against the old two-argument shape still fit and keep using the authenticated share route. `SiaShareSource` is exported from both entries.
- Direct-from-Sia playback: when the client has a Sia session, hls.js loads manifests and segments through a custom loader that downloads them from Sia hosts. Safari's native HLS and clients without a session keep using the gateway.
- `onDeliveryChange` reports whether a load is served from Sia or the gateway, and `onQualitiesChange` reports the rendition ladder.
- Quality control on the player handle: `getQualities()`, `setQuality(index)` and `isAutoQuality()`.
- `@sluby/player/hls`: a React-free entry that exports `createSiaLoader`, so plain hls.js apps can stream straight from Sia.
- `LICENSE` and `NOTICE` ship in the package.

### Fixed

- When the master playlist failed to load, the player retried with `startLoad()`, which does nothing before a manifest is parsed, and stayed on the spinner without calling `onError`. It now retries with `loadSource()` and reports the error after the retries.
- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.

## 0.1.0

First release.

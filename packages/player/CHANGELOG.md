# Changelog

## Unreleased

### Added

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

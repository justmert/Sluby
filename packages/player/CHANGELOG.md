# Changelog

## Unreleased

### Added

- Direct-from-Sia playback: when the client has a Sia session, hls.js loads manifests and segments through a custom loader that downloads them from Sia hosts. Safari's native HLS and clients without a session keep using the gateway.
- `onDeliveryChange` reports whether a load is served from Sia or the gateway, and `onQualitiesChange` reports the rendition ladder.
- Quality control on the player handle: `getQualities()`, `setQuality(index)` and `isAutoQuality()`.
- `LICENSE` and `NOTICE` ship in the package.

### Fixed

- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.

## 0.1.0

First release.

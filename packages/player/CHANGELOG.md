# Changelog

## 0.3.0 (2026-10-21)

### Added

- Hybrid delivery: `siaDelivery="hybrid"` plays playlists, the start and any urgent segment through the gateway, and takes segments from Sia once the buffer holds `minBufferSec` and the rendition's hosts have answered a warm-up read. A Sia read that fails or would outlast the buffer is handed to the gateway, and repeated failures pause Sia. `hybridPolicy` tunes it and `onDeliveryStats` reports where the bytes came from. On a home connection a 10 second video started in about 6 seconds this way, against 33 to 36 seconds direct from Sia. `createHybridLoader` brings the same loader to plain hls.js from `@sluby/player/hls`. The default stays `direct`.

### Changed

- `onDeliveryChange` can also report `hybrid`. A handler typed for only `'sia' | 'gateway'` needs the wider type.

## 0.2.0 (2026-10-08)

### Breaking

- `PlaybackResolver` no longer has `resolveDeliveryUrl`, which the player never called, and `client` also accepts any `{ sia }` (`SiaPlaybackClient`). A `SlubyClient` still fits. Migration: an object literal typed as `PlaybackResolver` must drop the member.
- The unused `SiaShareMap` type is removed from the player; it is the SDK's type. Migration: import it from `@sluby/sdk`.
- `useVideo`'s `setQuality` goes back to adaptive (-1) for an index outside the levels, like the player handle's, instead of passing it to hls.js, and `seek()` before metadata no longer clamps the time to 0.
- The overlay no longer renders a `<style>` element or the global `sluby-spinner` class and `sluby-spin` keyframes; the spinner turns through the Web Animations API. Migration: style the overlay through `[data-sluby-overlay]` and `[data-sluby-spinner]` instead of `.sluby-spinner`.
- A private asset played through `client` + `assetId` without `signed` is now played through a signed URL; it used to fail with "Network error, gave up after 3 retries".
- The SiaLoader reports a failed read with a 502 status (or the session's own 4xx), not 0, so hls.js retries it like a failed HTTP fragment instead of switching rendition or failing at once.
- `engines` requires Node 20.16+ or 22.3+, and the `react` and `react-dom` peers are optional, since `@sluby/player/hls` does not use them.

### Added

- A private asset played through `client` + `assetId` shows the poster the backend signs with the playback URL (`posterUrl` from `playback.getSignedUrl`); before, signed playback never had one. A backend before this change signs none, and the player then shows no poster as before.
- `useVideo(playerRef)`: pass a `<SlubyPlayer>` ref and the hook follows the player's `<video>` and every hls.js instance it builds. The README's pattern of copying the handle's element into refs never updated.
- `refreshSrc`: called shortly before a signed `src` expires (and when a load fails after it), it returns a newly signed `src`, and playback carries on without a reload.
- Signed URLs the player fetches itself are renewed before they expire, without a reload.
- A renewed URL, or a newly signed `src` prop for the same video, keeps the same hls.js instance and buffer: the player reads the renewed playlists and sends hls.js's later requests to the newly signed URLs, so nothing is fetched twice and the video does not seek. On Sia delivery it fetches the share map for the new `src`. Native HLS (Safari without MediaSource) still reloads at the position.
- Retry continues from the position playback had reached instead of 0.
- `onError`'s error carries the underlying error (an SDK `SlubyError`, an hls.js error) as `cause`.
- The loading overlay has `role="status"` with a hidden label and the error overlay `role="alert"`.
- A warning when `signed` or `expiresIn` is set together with `src`, which ignores them, and an error that says what is missing when a client without `playback` is asked to play an `assetId` without `src`.

- Keyless direct-from-Sia playback: with `src`, `assetId` and a `client` that has a Sia session, the player streams `src` from Sia using the public share map for it (`GET /v1/share/:id`, with the URL's signature when it is signed), so a public page needs no API key. It does not start a gateway load before the session is ready, and Safari's native HLS and session failures still fall back to the gateway.
- `createSiaLoader(session, assetId, { src })` does the same for plain hls.js apps through `@sluby/player/hls`, and loads a `/v1/stream/{id}/master.m3u8` URL through the session's master object id.
- `SiaPlaybackSession` takes an optional `source` on `prepare` and `resolveObjectId` and an optional `masterObjectId`; sessions written against the old two-argument shape still fit and keep using the authenticated share route. `SiaShareSource` is exported from both entries.
- Direct-from-Sia playback: when the client has a Sia session, hls.js loads manifests and segments through a custom loader that downloads them from Sia hosts. Safari's native HLS and clients without a session keep using the gateway.
- `onDeliveryChange` reports whether a load is served from Sia or the gateway, and `onQualitiesChange` reports the rendition ladder.
- Quality control on the player handle: `getQualities()`, `setQuality(index)` and `isAutoQuality()`.
- `@sluby/player/hls`: a React-free entry that exports `createSiaLoader`, so plain hls.js apps can stream straight from Sia.
- `LICENSE` and `NOTICE` ship in the package.
- `title`: the video's name for screen readers, set as the `<video>`'s `aria-label`. Without it a screen reader announced only "video".
- `tracks`: WebVTT caption and subtitle files rendered as `<track>` elements, and `crossOrigin` for the `<video>`, which tracks on another origin need. The player sets no `crossorigin` unless asked, so media loads as before.

### Changed

- Quality names use the short side of the picture, so a portrait 720 × 1280 rendition is `720p` (it was `1280p`), matching the landscape ladder.

### Fixed

- The player calls `play()` once the video can play and hls.js has finished seeking (to the position a retry or a renewed URL continues from, or over the gap before the first buffered frame), not as soon as the manifest is parsed. In WebKit a `play()` pending during that seek could leave the video playing with its clock stopped for good.
- `onStateChange` skipped `loading` when the manifest was parsed before React rendered it; every transition is now reported as it happens, in order.
- The overlay Retry built an hls.js instance on the stale (possibly expired) URL or share map before the fresh one.
- A poster resolved for one asset stayed after switching to another asset or to a plain `src`.
- Toggling `autoPlay` or changing `maxNetworkRetries` or `maxMediaRetries` tore down and restarted playback; they now apply to the next load or error.
- `useVideo` attached its listeners only if the video existed on the first render, kept the levels of a destroyed hls.js instance, and kept a stale instance after a retry.
- The `@sluby/player/hls` declarations referenced `React.CSSProperties`, so they needed `@types/react`.
- When the master playlist failed to load, the player retried with `startLoad()`, which does nothing before a manifest is parsed, and stayed on the spinner without calling `onError`. It now retries with `loadSource()` and reports the error after the retries.
- CommonJS consumers now get CommonJS type declarations (`index.d.cts`) instead of the ESM ones.

## 0.1.0

First release.

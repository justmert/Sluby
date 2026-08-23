# @sluby/player

Production-ready React player for [Sluby](https://github.com/justmert/sluby),
decentralized video on Sia. Wraps [hls.js](https://github.com/video-dev/hls.js)
with adaptive quality, bounded automatic error recovery, loading / error states,
and Safari native HLS fallback. Segments are fetched directly from Sia-backed
delivery.

## Install

```bash
npm install @sluby/player hls.js
# react and react-dom are peer dependencies (React 18 or 19)
```

## Usage

Point it at a manifest URL:

```tsx
import { SlubyPlayer } from '@sluby/player';

<SlubyPlayer src="https://cache.sluby.app/v1/objects/abc?type=manifest" controls />;
```

Or hand it a `SlubyClient` and an asset id, and it resolves the delivery URL
itself:

```tsx
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer } from '@sluby/player';

const client = new SlubyClient({ apiKey: 'sluby_...', baseUrl: 'https://api.sluby.app' });

<SlubyPlayer client={client} assetId="…" />;
// Private content: <SlubyPlayer client={client} assetId="…" signed expiresIn={3600} />
```

## Props

| Prop                                                                                   | Type                    | Notes                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `src`                                                                                  | `string`                | Absolute HLS master manifest URL.                                             |
| `client` + `assetId`                                                                   | `SlubyClient`, `string` | Alternative to `src`; the player resolves the URL.                            |
| `signed`, `expiresIn`                                                                  | `boolean`, `number`     | Resolve a signed URL for private content.                                     |
| `autoPlay`, `controls`, `muted`                                                        | `boolean`               | Standard playback flags.                                                      |
| `poster`, `width`, `height`, `className`, `style`                                      |                         | Passed through to the video / wrapper.                                        |
| `overlay`                                                                              | `boolean`               | Built-in spinner / error overlay. Default `true`.                             |
| `maxNetworkRetries`, `maxMediaRetries`                                                 | `number`                | Recovery caps. Defaults 3 and 2.                                              |
| `onReady`, `onPlay`, `onPause`, `onEnd`, `onError`, `onQualityChange`, `onStateChange` | callbacks               | `onStateChange` reports `idle` / `loading` / `ready` / `buffering` / `error`. |

## Headless control

`useVideo(videoRef, hlsRef)` returns play/pause/seek, quality selection, and live
state (duration, currentTime, buffering, volume) for building custom controls.
Get the refs from the player via its imperative handle
(`getVideoElement()` / `getHlsInstance()`).

## License

Apache-2.0

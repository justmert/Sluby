# @sluby/player

React player for [Sluby](https://github.com/justmert/Sluby), the self-hosted video platform that stores its media on Sia. It wraps [hls.js](https://github.com/video-dev/hls.js) with adaptive quality, bounded automatic error recovery, loading and error states, and Safari's native HLS fallback. By default it plays through the Sluby gateway; given a viewer identity, it downloads the bytes straight from Sia hosts instead.

## Install

```bash
npm install @sluby/player
# hls.js comes with it. react and react-dom (18 or 19) are optional peer
# dependencies: the react player needs them, @sluby/player/hls does not
```

## Usage

Point it at a manifest URL:

```tsx
import { SlubyPlayer } from '@sluby/player';

<SlubyPlayer src="https://video.example.com/v1/objects/abc?type=manifest" controls />;
```

Or hand it a `SlubyClient` and an asset id, and it resolves the delivery URL itself:

```tsx
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer } from '@sluby/player';

const client = new SlubyClient({ apiKey: 'sluby_...', baseUrl: 'https://video.example.com' });

<SlubyPlayer client={client} assetId="…" />;
// Private content: <SlubyPlayer client={client} assetId="…" signed expiresIn={3600} />
```

Create the client once (outside the component, or in `useMemo`), not on every render: a different `client` makes the player resolve and load the video again. A private asset is played through a signed URL even without `signed`. Before a signed URL the player fetched expires, it fetches a new one and continues from the same position.

Direct from Sia with no API key in the page: give it the playback URL, the asset id and a keyless client with a viewer identity. The share map comes from the public `/v1/share/:id`, gated by the URL's own signature for private content.

```tsx
const viewer = new SlubyClient({
  baseUrl: 'https://video.example.com',
  sia: { indexerUrl, appId, appKey },
});

<SlubyPlayer src={viewer.playback.streamUrl(id)} client={viewer} assetId={id} />;
// Private content: <SlubyPlayer src={signedUrlFromYourServer} client={viewer} assetId={id} />
```

A signed `src` stops working at its `expires`, and so does the share map fetched for it. Pass `refreshSrc` (it gets the current `src` and returns a newly signed one, for example from your server) and the player renews it shortly before then without reloading the video: it reads the renewed playlists and sends its later requests to the newly signed URLs. A new `src` prop for the same video does the same. With `src`, `client` only needs its `sia` session, so `{ sia: viewer.sia }` works too.

In a Vite or webpack app, the WASM package behind the viewer session needs a small bundler setting; see "Direct from Sia in a bundled app" in the `@sluby/sdk` README. Without it the player plays from the gateway and logs a warning.

Plain hls.js apps get the same from `@sluby/player/hls`:

```ts
import { createSiaLoader } from '@sluby/player/hls';

await viewer.sia!.prepare(id, { src });
const hls = new Hls({ loader: createSiaLoader(viewer.sia!, id, { src }) });
hls.loadSource(src);
```

## Props

| Prop                                                                                   | Type                    | Notes                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`                                                                                  | `string`                | Absolute HLS master manifest URL.                                                                                                                              |
| `refreshSrc`                                                                           | `(src) => string`       | Returns a newly signed `src` before the current one expires (may be async).                                                                                    |
| `client` + `assetId`                                                                   | `SlubyClient`, `string` | Alone: the player resolves the URL. With `src`: direct from Sia, no key.                                                                                       |
| `signed`, `expiresIn`                                                                  | `boolean`, `number`     | Resolve a signed URL for private content. Ignored with `src`.                                                                                                  |
| `autoPlay`, `controls`, `muted`                                                        | `boolean`               | Standard playback flags.                                                                                                                                       |
| `poster`, `width`, `height`, `className`, `style`                                      |                         | Passed through to the video / wrapper.                                                                                                                         |
| `overlay`                                                                              | `boolean`               | Built-in spinner / error overlay. Default `true`.                                                                                                              |
| `maxNetworkRetries`, `maxMediaRetries`                                                 | `number`                | Recovery caps. Defaults 3 and 2.                                                                                                                               |
| `onReady`, `onPlay`, `onPause`, `onEnd`, `onError`, `onQualityChange`, `onStateChange` | callbacks               | `onStateChange` reports `idle` / `loading` / `ready` / `buffering` / `error`. `onError`'s error has the underlying one as `cause`.                             |
| `onQualitiesChange`                                                                    | callback                | Every rendition in the manifest, once parsed (hls.js path).                                                                                                    |
| `siaDelivery`                                                                          | `'direct' \| 'hybrid'`  | With a viewer session: `direct` (default) streams everything from Sia; `hybrid` plays the start and urgent segments through the gateway and the rest from Sia. |
| `hybridPolicy`                                                                         | `Partial<HybridPolicy>` | Thresholds for `hybrid`: `minBufferSec` (10), `safetyMarginSec` (4), `maxSiaWaitMs` (20000), `maxFailures` (3), `pauseMs` (60000).                             |
| `onDeliveryChange`                                                                     | callback                | `sia` (bytes straight from Sia hosts), `hybrid` or `gateway` for the current load.                                                                             |
| `onDeliveryStats`                                                                      | callback                | Under `hybrid`, bytes and segments from each side so far, after every segment.                                                                                 |

## Quality switching

The ref handle lists the renditions and pins one:

```tsx
const player = useRef<SlubyPlayerHandle>(null);

<SlubyPlayer ref={player} client={client} assetId="…" onQualitiesChange={setLevels} />;

player.current?.setQuality(levels[0].index); // pin a rendition
player.current?.setQuality(-1); // back to adaptive
player.current?.isAutoQuality();
```

On Safari's native HLS path the browser picks the rendition and the list is empty.

## Headless control

`useVideo(playerRef)` returns play/pause/seek, quality selection, and live state (duration, currentTime, buffering, volume) for building custom controls on the player. It follows the player's `<video>` and every hls.js instance the player builds (one per load):

```tsx
const player = useRef<SlubyPlayerHandle>(null);
const { isPlaying, currentTime, duration, play, pause, qualities, setQuality } = useVideo(player);

<SlubyPlayer ref={player} client={client} assetId="…" controls={false} />;
```

For a player of your own, pass a `<video>` ref and an hls.js instance ref instead: `useVideo(videoRef, hlsRef)`.

## License

Apache-2.0

# Playing Sluby videos

Contents: playback URLs, public videos in React, private videos with signed URLs, the watch page and iframe, playback ids, revoking access, streaming straight from Sia, player props.

Only an asset with status `ready` plays.

## Playback URLs

| URL                                                                                 | Who can open it                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `https://sluby.example.com/v1/stream/<id>/master.m3u8`                              | Anyone, for a public asset. `<id>` is an asset id or a `pb_...` playback id               |
| The same URL plus `?expires=...&sig=...`                                            | Anyone holding it, until it expires. Needed for a private asset or a `signed` playback id |
| `https://sluby.example.com/v1/objects/<manifest>?type=manifest&expires=...&sig=...` | The `signedUrl` that `getSignedUrl` returns; works the same way                           |
| `https://sluby.example.com/watch/<id>`                                              | A ready-made player page, same rules as the stream URL                                    |

These URLs need no API key and no cookies, and any website can load them.

## Public video in React

```tsx
import { SlubyPlayer } from '@sluby/player';
import { SlubyClient } from '@sluby/sdk';

// browser code: a public video plays with no API key
const sluby = new SlubyClient({ baseUrl: 'https://sluby.example.com' });

export function PublicVideo({ id }: { id: string }) {
  return <SlubyPlayer src={sluby.playback.streamUrl(id)} title="Conference talk" controls />;
}
```

`streamUrl` only builds the URL; it makes no request. Without React, hand the same URL to hls.js, or to the `<video>` element in Safari, which plays HLS natively.

## Private video with a signed URL

Your server mints the signed URL with the key, after it checks that the viewer is allowed to watch. The browser never sees the key.

```ts
import { createServer } from 'node:http';
import { SlubyClient } from '@sluby/sdk';

const sluby = new SlubyClient({
  baseUrl: process.env.SLUBY_URL!,
  apiKey: process.env.SLUBY_API_KEY!,
});

// your pages call this route; check here that the viewer is allowed to watch the video
createServer(async (req, res) => {
  const match = /^\/signed-video-url\/([^/?]+)$/.exec(req.url ?? '');
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  try {
    const { signedUrl, posterUrl, expiresAt } = await sluby.playback.getSignedUrl(
      decodeURIComponent(match[1]),
      { expiresIn: 3600 },
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signedUrl, posterUrl, expiresAt }));
  } catch (err) {
    console.error(err);
    res.writeHead(502).end();
  }
}).listen(8080);
```

The page plays it and asks for a fresh URL before this one expires:

```tsx
import { useEffect, useState } from 'react';
import { SlubyPlayer } from '@sluby/player';

// asks your own server (the route above) for a signed URL
async function signedUrl(id: string): Promise<string> {
  const res = await fetch(`/signed-video-url/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Could not get a signed URL (${res.status})`);
  const body = (await res.json()) as { signedUrl: string };
  return body.signedUrl;
}

export function PrivateVideo({ id }: { id: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    signedUrl(id).then(setSrc, console.error);
  }, [id]);
  // refreshSrc gets a new URL before this one expires, so playback carries on
  return src ? <SlubyPlayer src={src} refreshSrc={() => signedUrl(id)} controls /> : null;
}
```

- `expiresIn` is in seconds. The server keeps it between 60 and 21600 and uses 3600 when you leave it out. The SDK throws a `RangeError` for zero, a negative number or a fraction.
- The manifest, every playlist and every segment of a signed URL stop working at `expiresAt`. Without `refreshSrc`, playback of a signed `src` fails at that time.
- `posterUrl` is the video's first thumbnail, signed until the same time. Pass it as the player's `poster`.

## Watch page and iframe

`https://sluby.example.com/watch/<id>` shows the video in a player page. Link to it, or embed it:

```html
<iframe
  src="https://sluby.example.com/watch/ASSET_ID"
  title="Video"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  style="width: 100%; aspect-ratio: 16 / 9; border: 0"
></iframe>
```

For a private video, take the query string of a signed URL from your server and add it to the watch page URL. The page reads its `expires` and `sig`:

```html
<iframe
  id="video"
  title="Video"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
  style="width: 100%; aspect-ratio: 16 / 9; border: 0"
></iframe>
<script type="module">
  // your server's route from the signed URL sample; the API key stays there
  const res = await fetch('/signed-video-url/ASSET_ID');
  const { signedUrl } = await res.json();
  document.getElementById('video').src =
    'https://sluby.example.com/watch/ASSET_ID' + new URL(signedUrl).search;
</script>
```

Without a valid signature the page answers `403` and shows "This video needs a signed link"; after expiry it shows "This link has expired".

## Playback ids

A playback id is a public `pb_...` handle for an asset. Use it wherever an asset id goes in a playback or watch URL, and delete it to cut off every URL built on it without touching the asset.

```ts
import { SlubyClient } from '@sluby/sdk';

const sluby = new SlubyClient({
  baseUrl: process.env.SLUBY_URL!,
  apiKey: process.env.SLUBY_API_KEY!,
});
const assetId = process.argv[2];

const { playbackId } = await sluby.playbackIds.create(assetId, {
  policy: 'public',
  name: 'partner site',
});
console.log(sluby.playback.streamUrl(playbackId)); // .../v1/stream/pb_.../master.m3u8

// later: every URL built on this playback id stops working
await sluby.playbackIds.delete(playbackId);
```

- `policy: 'public'` (the default) plays for anyone. `policy: 'signed'` plays only with `expires` and `sig`: call `getSignedUrl` with the `pb_...` id and add the signed URL's query string to the playback or watch URL.
- A `signed` playback id does not make a public asset private. The asset's own id still plays it. To restrict the asset, set its `accessTier` to `private`.
- Creating and deleting needs the `manage` scope, listing needs `read`.

## Revoking access

- Delete a playback id: URLs that use it stop working.
- Revoke an asset's signed URLs: `POST /api/v1/playback/{id}/signed/revoke` (`manage` scope) stops every signed URL minted for it so far. New ones work right after.
- Change the asset's `accessTier`: signed URLs minted before the change stop working.

## Streaming straight from Sia

When the server's operator provides a viewer identity (an indexer URL, app id and app key, all publishable), the player can fetch the video bytes from Sia hosts instead of the Sluby server:

```tsx
import { useMemo } from 'react';
import { SlubyPlayer } from '@sluby/player';
import { SlubyClient, type SiaViewerConfig } from '@sluby/sdk';

// viewer: the publishable viewer identity (indexerUrl, appId, appKey) from the server's operator
export function SiaVideo({ id, viewer }: { id: string; viewer: SiaViewerConfig }) {
  const sluby = useMemo(
    () => new SlubyClient({ baseUrl: 'https://sluby.example.com', sia: viewer }),
    [viewer],
  );
  return (
    <SlubyPlayer
      client={sluby}
      assetId={id}
      src={sluby.playback.streamUrl(id)}
      siaDelivery="hybrid"
      onDeliveryChange={(mode) => console.log('playing from', mode)}
      controls
    />
  );
}
```

With a viewer identity on the client, `siaDelivery="direct"` (the default) takes every playlist and segment from Sia. `"hybrid"` starts through the server and takes the rest from Sia once the buffer allows. `onDeliveryChange` reports `sia`, `hybrid` or `gateway`.

`siaDelivery`, `hybridPolicy` and `onDeliveryStats` are in the `@sluby/player` source on the `main` branch of `justmert/Sluby`; the npm release 0.2.0 does not have them. With 0.2.0, leave `siaDelivery` out: a player with a viewer session takes every playlist and segment from Sia, and `onDeliveryChange` reports `sia` or `gateway`.

## SlubyPlayer props you use most

| Prop                                                                               | What it does                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`                                                                              | The HLS URL: `streamUrl(id)` or a signed URL                                                                                                                                              |
| `refreshSrc`                                                                       | `(src) => string or Promise<string>`: returns a fresh signed URL before the current one expires                                                                                           |
| `client`, `assetId`                                                                | With `src`, enable streaming from Sia. Without `src`, the player resolves the URL through the API with the client, which suits only a same-origin cookie session, never a browser API key |
| `title`                                                                            | The video's name for screen readers                                                                                                                                                       |
| `poster`, `controls`, `autoPlay`, `muted`, `width`, `height`, `className`, `style` | As on `<video>`                                                                                                                                                                           |
| `tracks`                                                                           | WebVTT captions or subtitles: `{ src, kind, srclang, label, default }`                                                                                                                    |
| `onReady`, `onPlay`, `onPause`, `onEnd`, `onError`, `onStateChange`                | Playback events                                                                                                                                                                           |
| `onQualityChange`, `onQualitiesChange`                                             | The rendition playing, and every rendition in the manifest                                                                                                                                |

For custom controls, pass a ref to `SlubyPlayer` (type `SlubyPlayerHandle`) to the `useVideo` hook, which returns `play`, `pause`, `seek`, `setQuality`, `qualities`, `currentTime`, `duration` and more.

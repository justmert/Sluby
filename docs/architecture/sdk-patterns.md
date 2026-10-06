# SDK integration patterns

`@sluby/sdk` wraps the REST API, tus uploads and webhook verification; `@sluby/player` is a React player built on hls.js. This page shows how they fit into an application, given how the backend behaves. The code uses the real signatures from `packages/sdk/src` and `packages/player/src`.

The general shape: keep API keys on your server, do uploads and URL minting there, and give the browser only what it needs to play.

```mermaid
flowchart LR
  subgraph yourserver [Your server]
    sdk["@sluby/sdk<br/>secret API key"]
    hook[webhook receiver]
  end
  subgraph sluby [Sluby]
    api["/api/v1"]
    gw["/v1/objects, /v1/stream"]
  end
  subgraph browser [Viewer browser]
    player["@sluby/player"]
  end
  sdk -- "uploads, playback URLs, signed URLs" --> api
  api -- "asset.ready, asset.errored" --> hook
  sdk -. "playback URL or signed URL" .-> player
  player -- "manifests and segments" --> gw
```

## Server-side upload with a secret key

```ts
import { readFile } from 'node:fs/promises';
import { SlubyClient } from '@sluby/sdk';

const sluby = new SlubyClient({
  baseUrl: 'https://video.example.com',
  apiKey: process.env.SLUBY_API_KEY!,
});

const file = await readFile('talk.mp4');
const upload = sluby.uploads.upload(file, {
  title: 'Conference talk',
  accessTier: 'public',
  onProgress: (percent) => console.log(`uploaded ${percent}%`),
});

const assetId = await upload.assetId;
await upload;
```

- The key needs the `upload` scope, and `read` as well to poll the asset afterwards. Create a dedicated key per service in the Studio or with `POST /api/v1/keys`.
- `upload()` returns at once. `upload.assetId` resolves as soon as the server has created the asset, which is right after the upload starts, so you can store the id before the bytes finish; awaiting `upload` itself waits for the last byte.
- In Node, pass a `Buffer`. The SDK's type also allows `File` and `Blob`, but tus-js-client's Node reader accepts only a `Buffer` or a readable stream, so a `Blob` is rejected at runtime. A `Buffer` holds the whole file in memory.
- The upload is resumable: tus retries failed chunks after 0, 1, 3 and 5 seconds by default (`retryDelays`), and the handle has `pause()`, `resume()` and `abort()`. `abort()` terminates the upload and the backend deletes the asset it created.
- `accessTier: 'private'` makes the asset need signed URLs from the start. The tier can be changed later with `sluby.assets.update(assetId, { accessTier })`.

## Knowing when an asset is ready

Processing takes from seconds to many minutes depending on the video length and the Sia network, so the result arrives asynchronously. There are two ways to learn about it.

### Polling

```ts
import { TimeoutError } from '@sluby/sdk';

try {
  const asset = await sluby.assets.waitForReady(assetId, {
    pollInterval: 10_000,
    timeout: 30 * 60_000,
  });
  console.log('ready', asset.id, asset.durationMs);
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log('still processing, check again later');
  } else {
    const job = await sluby.assets.processing(assetId);
    console.error('processing failed at', job.stage, job.errorMessage);
  }
}
```

`waitForReady` calls `GET /api/v1/assets/:id` every `pollInterval` milliseconds (5 seconds by default) until the status is `ready`. It rejects with a plain `Error` when the asset becomes `failed` and with `TimeoutError` after `timeout` (10 minutes by default). Each poll counts against the key's rate limit, 100 requests a minute by default. `assets.processing(assetId)` returns the stage, percentage, error and log lines, which is what to show a user while they wait.

Polling needs nothing but outbound HTTP, so it suits scripts, CLIs and servers that cannot receive inbound requests.

### Webhooks

Webhook endpoints are registered with the REST API (the SDK has no method for it) or in the Studio, with a key that has the `manage` scope:

```ts
const created = await fetch('https://video.example.com/api/v1/webhooks', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SLUBY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://app.example.com/hooks/sluby',
    events: ['asset.ready', 'asset.errored'],
  }),
});
const { id, secret } = await created.json();
```

The response contains the endpoint's `secret` once; store it. The endpoint receives the events of every asset owned by the key's account, whichever key uploaded it. Verify every delivery against the raw body before trusting it:

```ts
import express from 'express';
import { WebhookManager } from '@sluby/sdk';

const webhooks = new WebhookManager();
const app = express();

app.post('/hooks/sluby', express.text({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('X-Sluby-Signature') ?? '';
  const valid = await webhooks.verifySignatureAsync(
    req.body,
    signature,
    process.env.SLUBY_WEBHOOK_SECRET!,
  );
  if (!valid) {
    res.sendStatus(401);
    return;
  }
  const event = webhooks.parseEvent(req.body);
  if (event.event === 'asset.ready') {
    console.log('ready to play', event.data.video_asset_id);
  } else if (event.event === 'asset.errored') {
    console.error('failed at', event.data.stage, event.data.error);
  }
  res.sendStatus(204);
});
```

- The signature is an HMAC-SHA256 of the exact bytes sent, so parse the body as text (`express.text`), not JSON, or re-serializing may change it.
- Use `verifySignatureAsync`: it runs on Web Crypto and works in Node, browsers and edge runtimes. The synchronous `verifySignature` relies on CommonJS `require` and throws when the SDK is loaded as an ES module.
- There is no timestamp or nonce in the signature beyond the `timestamp` field inside the signed body. Check that field if replayed deliveries matter to you.
- Answer within 10 seconds with a 2xx. Failed deliveries are retried after 10 seconds, 1 minute and 5 minutes with the same body; make handling idempotent (key on `video_asset_id` and `event`).
- Retries are held in memory by the backend and lost if it restarts. For anything that must not be missed, keep a slow poll as a backstop, for example re-checking assets that have been processing for longer than expected.

|                | Polling                             | Webhooks                                        |
| -------------- | ----------------------------------- | ----------------------------------------------- |
| Needs          | outbound HTTP only                  | a public HTTPS endpoint                         |
| Latency        | up to one poll interval             | seconds after finalize                          |
| Cost           | one API call per interval per asset | one request per event                           |
| Missed results | none, the next poll sees them       | possible if the backend restarts during retries |
| Detail         | full asset and processing log       | the event payload                               |

## Playing in the browser

How the player gets its URL depends on whether the browser may hold a credential.

### Public pages without credentials

For a public asset, resolve the playback URL on your server and hand only the URL to the page. The key never reaches the browser:

```ts
const { playbackUrl, posterUrl } = await sluby.playback.getUrl(assetId);
```

```tsx
import { SlubyPlayer } from '@sluby/player';

export function Watch({
  playbackUrl,
  posterUrl,
}: {
  playbackUrl: string;
  posterUrl: string | null;
}) {
  return <SlubyPlayer src={playbackUrl} poster={posterUrl ?? undefined} width="100%" />;
}
```

`playbackUrl` points at the master manifest on the gateway (`/v1/objects/{id}?type=manifest`, made absolute with `deliveryBaseUrl`), and every object of a public asset is served without credentials. An alternative is a playback id: create one with `POST /api/v1/assets/:id/playback-ids` (scope `manage`, body `{ "policy": "public" }`) and use `https://video.example.com/v1/stream/{playback_id}/master.m3u8` as `src`. Deleting the playback id later stops that URL, but not the asset's object URLs.

The player uses the browser's native HLS when hls.js is not supported (no Media Source Extensions) and the browser can play HLS itself, and retries network errors up to `maxNetworkRetries` times (3 by default) before it shows an error with a Retry button.

::: warning
If the page is on a different origin than Sluby, gateway responses that pass through the bundled nginx currently carry `Access-Control-Allow-Origin` twice, which browsers reject. See [Playback](./playback#serving-objects).
:::

### Signed playback for private assets

For a private asset, mint a signed URL on the server, after checking that the viewer may watch it:

```ts
await sluby.assets.update(assetId, { accessTier: 'private' });

const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl(assetId, {
  expiresIn: 4 * 60 * 60,
});
```

```tsx
export function PrivateWatch({ signedUrl }: { signedUrl: string }) {
  return <SlubyPlayer src={signedUrl} width="100%" />;
}
```

The URL authorizes the whole asset until `expiresAt`: the gateway signs the playlists and segments inside the manifests with the same expiry. Choose `expiresIn` longer than the video plus pauses, because segments requested after the expiry get 403 and the player cannot renew the URL by itself. Anyone holding the URL can watch until then, so mint one per viewer and session. All signed URLs stop working if `SESSION_SECRET` changes.

### Apps where the browser holds a credential

The player can also resolve URLs itself from a `client` and an `assetId`. That calls `/api/v1/playback/:id` from the browser, so the browser needs a credential with `read` scope for the asset's owner. The Studio does this with its session cookie: it is served from the same origin as the API and creates its client without an API key.

```tsx
const sluby = new SlubyClient({
  baseUrl: window.location.origin,
  sia: {
    indexerUrl: import.meta.env.VITE_SLUBY_SIA_INDEXER_URL,
    appId: import.meta.env.VITE_SLUBY_SIA_APP_ID,
    appKey: import.meta.env.VITE_SLUBY_SIA_APP_KEY,
  },
});

export function LibraryPlayer({ assetId }: { assetId: string }) {
  return (
    <SlubyPlayer
      client={sluby}
      assetId={assetId}
      onDeliveryChange={(mode) => console.log('delivery:', mode)}
    />
  );
}
```

Add `signed` (and optionally `expiresIn`) to have the player request a signed URL instead. Do not put an API key in a public page's bundle to make this work: a `read` key lists and reads the whole account's library.

### Direct from Sia or through the gateway

The `sia` option above turns on direct-from-Sia playback: the player streams playlists and segments from Sia hosts with the viewer app key, and the backend only mints a share map per playback (see [Playback](./playback#the-direct-from-sia-path)). Without `sia`, or when hls.js is unavailable or the Sia session cannot start, it uses the gateway.

Things to weigh:

- **Egress.** On the gateway, the backend downloads from hosts with its own indexer account, and the nginx and memory caches absorb repeat requests for manifests and thumbnails. Direct, every viewer downloads every segment from hosts with the viewer app, and that app's account pays the egress; there is no shared cache.
- **Your bandwidth.** The gateway sends every media byte through your server. Direct playback sends none.
- **Credentials.** The share map comes from `/api/v1/playback/:id/share`, which needs `read` scope on the asset's owner, the same as the `client` and `assetId` pattern above. A public page without credentials uses the gateway.
- **Access control.** Share URLs are bearer capabilities: whoever has one can download that object until it expires (at most 1 hour for private or signed assets, 6 hours otherwise). The gateway checks every request.
- **Weight.** Direct playback loads about 1.7 MB of WASM on first use and needs hls.js, so browsers that only play HLS natively use the gateway.

`onDeliveryChange` tells you which path each load took.

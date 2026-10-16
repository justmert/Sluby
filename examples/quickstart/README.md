# Sluby quickstart example

A minimal React app that exercises the full flow with `@sluby/sdk` and `@sluby/player`. The [React guide](../../docs/guide/react.md) walks through it.

1. Upload a file with resumable tus upload (progress, pause and resume), public or private.
2. Follow processing (stage and percentage) until the asset is ready.
3. Play it with `<SlubyPlayer>`, signed when private, and pin a rendition or leave it adaptive.
4. Play any other asset of the account by id.
5. Delete the asset (the backend soft-deletes it and unpins its Sia objects).

## Run

The example consumes the built packages, so build them first from the repo root:

```bash
npm install
npm run build:sdk
npm run build:player
```

Then configure and start the app:

```bash
cd examples/quickstart
cp .env.example .env   # fill in VITE_SLUBY_API_KEY (and base URLs if not localhost)
npm run dev
```

Open the printed URL, pick a video, and follow the flow. Every field in the form (API base URL, delivery base URL, API key) can also be set at runtime, so you can point it at any Sluby backend without rebuilding.

An API key in the page is for local development only. Playback needs none: leave the key empty, enter an asset id or `pb_` playback id and press Play, and a public asset plays from its stream URL (`client.playback.streamUrl`), straight from Sia when a viewer identity is set. A private asset plays from a signed URL minted by a server that holds a key: paste it into the playback URL field, or point the API base URL at a signing server such as the plain JavaScript example's `server/playback-server.mjs` and tick "signed URL". Uploading, deleting and minting signed URLs still need a key.

To verify cross-browser playback and recovery (Chrome, Firefox, Safari), open the same URL in each browser after the asset is ready.

## Direct-from-Sia playback (optional)

By default the player fetches HLS bytes from the delivery gateway. To stream them straight from Sia in the browser instead (the backend leaves the byte path), give the player a viewer identity.

Provision one once from the backend (it prints a URL to approve in your indexer account, then the publishable config):

```bash
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Put the three printed values in `examples/quickstart/.env` (`VITE_SLUBY_SIA_INDEXER_URL`, `VITE_SLUBY_SIA_APP_ID`, `VITE_SLUBY_SIA_APP_KEY`) or paste them into the form's "Direct-from-Sia playback" fields. They are publishable, like a public playback key, and no API key is needed: the player fetches the asset's share map from the public `GET /v1/share/:id` with the playback URL's signature, if it has one. The player reports the path it took ("direct from Sia" or "gateway delivery"); it falls back to the gateway on Safari-native playback or if the viewer session is unavailable.

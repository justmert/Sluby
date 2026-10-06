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

An API key in the page is for local development only. To play without one, run the plain JavaScript example's playback server (`examples/vanilla/server/playback-server.mjs`), set the API base URL to it, the delivery base URL to Sluby, and leave the key empty. Uploading and deleting still need a key.

To verify cross-browser playback and recovery (Chrome, Firefox, Safari), open the same URL in each browser after the asset is ready.

## Direct-from-Sia playback (optional)

By default the player fetches HLS bytes from the delivery gateway. To stream them straight from Sia in the browser instead (the backend leaves the byte path), give the player a viewer identity.

Provision one once from the backend (it prints a URL to approve in your indexer account, then the publishable config):

```bash
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Put the three printed values in `examples/quickstart/.env` (`VITE_SLUBY_SIA_INDEXER_URL`, `VITE_SLUBY_SIA_APP_ID`, `VITE_SLUBY_SIA_APP_KEY`) or paste them into the form's "Direct-from-Sia playback" fields. They are publishable, like a public playback key. The player reports the path it took ("direct from Sia" or "gateway delivery"); it falls back to the gateway on Safari-native playback or if the viewer session is unavailable.

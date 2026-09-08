# Sluby quickstart example

A minimal web app that exercises the full Milestone 3 flow with `@sluby/sdk` and
`@sluby/player`:

1. Create an upload and send a file with resumable TUS upload (progress + pause/resume).
2. Poll the asset until processing finishes.
3. Embed `<SlubyPlayer>` and play it with adaptive quality and error recovery.
4. Delete the asset (the backend soft-deletes and unpins its Sia objects).

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

Open the printed URL, pick a video, and follow the flow. Every field in the
form (API base URL, delivery base URL, API key) can also be set at runtime, so
you can point it at any Sluby backend without rebuilding.

To verify cross-browser playback and recovery (Chrome, Firefox, Safari), open
the same URL in each browser after the asset is ready.

## Direct-from-Sia playback (optional)

By default the player fetches HLS bytes from the delivery gateway. To stream
them straight from Sia in the browser instead (the backend leaves the byte
path), give the player a viewer identity.

Provision one once from the backend (it prints a URL to approve in your indexer
account, then the publishable config):

```bash
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Put the three printed values in `examples/quickstart/.env`
(`VITE_SLUBY_SIA_INDEXER_URL`, `VITE_SLUBY_SIA_APP_ID`, `VITE_SLUBY_SIA_APP_KEY`)
or paste them into the form's "Direct-from-Sia playback" fields. They are
publishable, like a public playback key. When set, the ready view shows "direct
from Sia"; the player still falls back to the gateway on Safari-native playback
or if the viewer session is unavailable.

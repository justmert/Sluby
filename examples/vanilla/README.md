# Sluby plain JavaScript example

Sluby without a framework: `@sluby/sdk` for the API, hls.js for playback, and `@sluby/player/hls` for direct-from-Sia playback. The code is plain JavaScript modules, typechecked with `checkJs`. The [plain JavaScript guide](../../docs/guide/javascript.md) walks through it.

- `src/main.js`: upload with progress and pause, wait for processing, play, pick a rendition, delete
- `src/player.js`: playback with hls.js, native HLS on Safari without Media Source Extensions, signed URLs, direct from Sia with no API key
- `server/upload.mjs`: upload from Node.js with an API key
- `server/signing-server.mjs`: mints signed URLs for private assets with a key the browser never sees

## Run

Build the packages from the repository root first:

```bash
npm install
npm run build:sdk
npm run build:player
```

Then start the browser app:

```bash
cd examples/vanilla
cp .env.example .env   # optional: defaults for the form fields
npm run dev
```

Open http://localhost:5181. Playback needs no API key: leave the key empty, enter an asset id and press Play, and a public asset plays from its stream URL, straight from Sia when the viewer fields are set. A private asset needs a signed URL in the playback URL field (or the signing server below). Uploading and deleting need a key; entering one in the page is for local development only, see the guide for keeping keys on a server.

Upload from Node.js:

```bash
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... npm run upload -- ./video.mp4 "My video"
```

Mint signed URLs for private assets without a key in the browser (then set the page's base URL to `http://localhost:8787`, the delivery URL to Sluby, leave the key empty, and tick "signed URL"):

```bash
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... \
PLAYABLE_ASSET_IDS=<asset id> APP_ORIGINS=http://localhost:5181 \
  npm run signing-server
```

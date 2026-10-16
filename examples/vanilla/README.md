# Sluby plain JavaScript example

Sluby without a framework: `@sluby/sdk` for the API, hls.js for playback, and `@sluby/player/hls` for direct-from-Sia playback. The code is plain JavaScript modules, typechecked with `checkJs`. The [plain JavaScript guide](../../docs/guide/javascript.md) walks through it.

- `src/main.js`: upload with progress and pause, wait for processing, play, pick a rendition, delete
- `src/player.js`: playback with hls.js, native HLS on Safari without Media Source Extensions, signed URLs, direct from Sia
- `server/upload.mjs`: upload from Node.js with an API key
- `server/playback-server.mjs`: answers the browser's playback calls with a key the browser never sees

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

Open http://localhost:5181. Entering an API key in the page is for local development only; see the guide for keeping keys on a server.

Upload from Node.js:

```bash
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... npm run upload -- ./video.mp4 "My video"
```

Serve playback without a key in the browser (then set the page's base URL to `http://localhost:8787`, the delivery URL to Sluby, and leave the key empty):

```bash
SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... \
PLAYABLE_ASSET_IDS=<asset id> APP_ORIGINS=http://localhost:5181 \
  npm run playback-server
```

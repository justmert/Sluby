# Sluby

**Decentralized video streaming on Sia.**

Sluby takes a source video, transcodes it into adaptive HLS, stores every
segment on the [Sia network](https://sia.tech) via the `sia-storage` SDK, and
serves playback through a byte-range aware HTTP gateway with an Nginx on-disk
proxy cache in front.

## What's in the box

- **Resumable uploads** via the TUS protocol.
- **Adaptive HLS transcode**: FFmpeg produces 1080p/720p/540p/360p fMP4
  renditions with CMAF-style init segments and ~6s media segments.
- **Sia-backed object store**: every segment, init fragment, and playlist is
  an individual object on Sia, addressed by its storage key.
- **Delivery gateway**: an aggregator route fetches objects from Sia, caches
  them in an in-memory LRU (with `X-Cache-Status` headers and cache warming
  after a transcode), and streams byte-range responses suitable for
  `<video>` and hls.js playback.
- **REST API**: spec-first with a served OpenAPI 3.1 document. Scoped API
  keys (`upload`/`read`/`manage`), cursor-based asset pagination, playback
  ID management, and a per-asset Sia storage breakdown.
- **Reconciliation worker**: a background sweep that compares the database
  against the indexer's pinned inventory and flags drift (orphaned or
  missing objects).
- **SDK**: first-party TypeScript (`@sluby/sdk`) and React (`@sluby/react`)
  packages.

## Quick start

Requirements: Node.js 20+, Docker + Docker Compose, FFmpeg 5+ (only needed
when running the backend outside Docker).

```bash
git clone https://github.com/justmert/sluby.git
cd sluby
cp .env.example .env
docker compose up -d
```

This starts the backend, PostgreSQL, Redis, and an Nginx caching proxy. The
backend container listens on port 3000 and `docker-compose.yml` publishes it
as `4500:3000`, so from the host it is `http://localhost:4500`. The Nginx
proxy is on `http://localhost:80`.

### Sia onboarding

Before the first upload, the backend needs a `SIA_APP_ID` / `SIA_APP_KEY`
pair that registers the platform with your `indexd` instance. You produce
these once through the `sia-storage` connect/register flow: mint a connect
key on indexd's admin API (`POST /api/apps/connect/keys`), approve the
connection request, and export the resulting AppKey. Put both values in
`.env` and restart the backend, which re-attaches to indexd on startup.

```bash
# Optional: run a local indexer + walletd + miner stack for the Zen testnet
docker compose -f docker-compose.sia.yml up -d
```

### Local development

```bash
# Backend (hot reload via tsx watch)
cd backend && npm install && npm run dev

# Frontend (Vite)
cd frontend && npm install && npm run dev
```

Open the frontend at the URL Vite prints (defaults to
`http://localhost:5173`). Use the studio UI to create an API key, upload a
video, and copy its playback URL into the player page.

#### Which backend port?

The backend listens on a different host port depending on how you start it:

| How you start it            | Backend URL on the host | Where that comes from                                                                     |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `docker compose up -d`      | `http://localhost:4500` | the `4500:3000` port mapping in `docker-compose.yml`                                      |
| `cd backend && npm run dev` | `http://localhost:3000` | the `PORT` default in `backend/src/config/env.ts`, which `.env.example` also sets to 3000 |

The studio frontend and the SDK snippets below default to
`http://localhost:4500`, the Docker port. If you run the backend with
`npm run dev` instead, either set `PORT=4500` in `.env` or point the frontend
at the backend with `VITE_API_BASE_URL=http://localhost:3000`.

### Using the SDK

```ts
import { SlubyClient } from '@sluby/sdk';

const client = new SlubyClient({
  apiKey: 'sluby_your_api_key',
  // Docker publishes the backend on 4500. A local `npm run dev` backend
  // listens on 3000 unless you override PORT.
  baseUrl: 'http://localhost:4500',
});

const { videoAssetId, uploadUrl } = await client.uploads.create({
  title: 'My Video',
  accessTier: 'public',
});

await client.uploads.uploadFile(uploadUrl, file, {
  onProgress: (pct) => console.log(`${pct}%`),
});

const asset = await client.assets.waitForReady(videoAssetId);
```

```tsx
import { SlubyPlayer } from '@sluby/react';

<SlubyPlayer src={`http://localhost/v1/stream/${videoAssetId}/master.m3u8`} controls />;
```

## API reference

The REST API is described by an OpenAPI 3.1 document, served by the backend
(the URLs below use the Docker port 4500, so swap in 3000 for a local
`npm run dev` backend):

- Spec (JSON): `http://localhost:4500/api/v1/openapi.json`
- Interactive docs: `http://localhost:4500/api/v1/docs`

Programmatic calls authenticate with a `Bearer` API key; each key carries
`upload`, `read`, and `manage` scopes. Asset listing uses cursor pagination
(pass the `next_cursor` from one page back as `?cursor=` for the next).

## Architecture

```
┌─────────┐   TUS     ┌──────────────┐   FFmpeg   ┌──────────────┐
│ Client  ├──────────▶│  TUS server  ├───────────▶│  Transcoder  │
└─────────┘           └──────────────┘            └──────┬───────┘
                                                         │ per-segment put
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Sia object  │
                                                 │   storage    │
                                                 └──────┬───────┘
                                                        │
┌─────────┐   HLS     ┌──────────────┐   range fetch   │
│ Player  │◀─────────▶│ Nginx cache  │◀────────────────┘
└─────────┘           │ + aggregator │
                      └──────────────┘
```

Upload path: TUS server buffers the source, FFmpeg produces HLS renditions,
each output artifact is pushed to Sia through `sia-storage`, and the resulting
object references are persisted in Postgres. BullMQ (backed by Redis) drives
the transcode queue.

Playback path: the player can stream bytes **directly from Sia in the browser**
(the backend leaves the byte path), or fetch them through the gateway. In
direct mode the backend only mints a short-lived per-object share map and a
custom hls.js loader pulls the byte ranges from Sia; in gateway mode the
aggregator resolves the asset's object references from Postgres, pulls the bytes
from Sia on demand, and keeps hot manifests and small objects in an in-memory
LRU cache, with Nginx's `proxy_cache` in front. The same stored manifest serves
both. See [Direct-from-Sia playback](#direct-from-sia-playback).

## Direct-from-Sia playback

By default the player fetches HLS bytes from the delivery gateway. It can
instead stream them straight from Sia in the browser, with the backend out of
the byte path (the model the proposal describes: the client retrieves content
directly from Sia, no intermediary handles the playback data).

Two modes, from one stored manifest (objects are referenced as
`/v1/objects/{id}`, so no re-processing to switch):

- **Direct from Sia** (default when a viewer identity is configured): the
  player asks the backend for a short-lived, per-object share map, then a custom
  hls.js loader resolves each object and downloads its byte ranges from Sia. The
  backend serves only the small share-map JSON.
- **Gateway** (fallback): used for Safari native HLS, when no viewer identity is
  configured, or if the Sia session fails to start.

Enable it by provisioning a low-privilege viewer identity once (separate from
the uploader's key, safe to publish like a public playback key):

```bash
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Approve the printed URL in your indexer account; it prints three publishable
values. Pass them to the client (or set `VITE_SLUBY_SIA_*` in the quickstart):

```ts
const client = new SlubyClient({ apiKey, baseUrl, sia: { indexerUrl, appId, appKey } });
// <SlubyPlayer client={client} assetId={id} /> now streams directly from Sia.
```

Trade-offs: egress is paid by the downloading account, so direct mode moves
egress to the viewer account (fund it) and has no shared proxy cache (each
viewer pulls independently); use gateway mode for the shared cache. A share URL
carries the object's decryption key and bypasses the signed-URL gateway, so the
backend mints them owner-scoped and short-lived (shorter and non-cacheable for
private or signed-policy assets).

Verify the data path with `node scripts/e2e-sia-share.mjs` (opt-in; set the
`SIA_E2E_*` vars it prints when skipped). For the browser, run the quickstart
with the viewer config, open DevTools' Network tab filtered to your backend
origin, and confirm that during playback the manifest and segments do **not**
hit the backend's `/v1/objects` (they go to Sia hosts); the only backend calls
are `GET /api/v1/playback/:id` and `.../share`. One exception: the
`<video poster>` thumbnail is always served via the gateway, so you will see a
single `/v1/objects/{thumbnail}` request for it. Unset the viewer config to see
the manifest and segment requests reappear on `/v1/objects` (the gateway
fallback).

## Project layout

```
backend/       Node.js backend (Express + BullMQ + Drizzle + sia-storage SDK)
frontend/      Vite + React studio app
packages/sdk/  @sluby/sdk       TypeScript API client
packages/react/@sluby/react     SlubyPlayer + hooks
nginx/         Aggregator/gateway config
docker-compose.yml      App stack (backend, postgres, redis, nginx)
docker-compose.sia.yml  Optional local Sia indexer / walletd / miner stack
docker-compose.prod.yml Production overrides
```

## Tests

```bash
npm test --workspace=backend
npm test --workspace=@sluby/sdk
npm test --workspace=@sluby/react
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE).

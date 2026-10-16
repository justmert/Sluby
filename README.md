# Sluby

**Decentralized video streaming on Sia.**

Sluby takes a source video, transcodes it into adaptive HLS, stores every
segment on the [Sia network](https://sia.tech) via the official `@siafoundation/sia-storage` SDK, and
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
- **SDK and player**: first-party TypeScript (`@sluby/sdk`) and React
  (`@sluby/player`) packages.
- **Studio**: a Vite + React + shadcn/ui web app for uploading, watching
  processing, browsing the library, inspecting per-asset Sia storage,
  previewing playback, and managing API keys and webhooks.

## Quick start

Requirements: Docker with Compose v2 and a free [sia.storage](https://sia.storage) account.

```bash
git clone https://github.com/justmert/Sluby.git
cd Sluby
cp .env.example .env

# register the backend with the indexer: approve the printed url in your
# sia.storage account, then put SIA_APP_ID and SIA_APP_KEY into .env
docker compose run --rm --no-deps backend node scripts/connect-indexer.mjs

docker compose up -d
```

Open `http://localhost:8080`, upload a video in the Studio and play it. The
[quickstart guide](./docs/guide/quickstart.md) walks through each step, and
the [production guide](./docs/guide/production.md) covers TLS, GitHub sign-in
and connecting to an indexer on mainnet or the Zen testnet.

The documentation site lives in `docs/`:

```bash
npm ci --prefix docs
npm run docs:dev
```

### Local development

Run PostgreSQL and Redis from Compose and the backend and Studio from source
(Node.js 22.12+ and FFmpeg 5+ on the host):

```bash
npm install
docker compose up -d postgres redis

# the compose databases listen on 5433 and 6380
DATABASE_URL=postgresql://sluby:sluby@localhost:5433/sluby \
REDIS_URL=redis://localhost:6380 \
PUBLIC_URL=http://localhost:5173 \
npm run dev

# in another terminal
npm run dev:frontend
```

Open the Studio at `http://localhost:5173`. Vite proxies `/api` and `/v1` to
the backend on port 3000 (`STUDIO_API_PROXY_TARGET` overrides it), so the
Studio and the API share one origin and the sign-in cookie reaches every
request, including tus uploads.

| How you start it        | API base URL            |
| ----------------------- | ----------------------- |
| `docker compose up -d`  | `http://localhost:8080` |
| `npm run dev` (backend) | `http://localhost:3000` |
| `npm run dev:frontend`  | `http://localhost:5173` |

## Studio

The Studio (`frontend/`) is the management UI. It is built with Vite, React
and shadcn/ui, talks to the API through `@sluby/sdk`, and plays video with
`@sluby/player`, the same packages an app would use.

| Page      | What it does                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Asset totals by status, bytes stored on Sia, latest uploads, gateway cache statistics, and live indexer status (account usage, host pool, database and Redis health). |
| Upload    | Drag and drop, resumable tus upload with byte and chunk progress, pause, resume and cancel, then the processing pipeline stage by stage with its log and a retry.     |
| Assets    | Server-side search (title, description or id), status and access filters, sorting, grid and list views, bulk delete.                                                  |
| Asset     | Embedded player with a rendition picker and the delivery path (direct from Sia or gateway), the rendition ladder, and the Sia breakdown described below.              |
| Developer | Copy-ready JavaScript and curl snippets for every common task (typechecked against the SDK in tests), webhooks, and an API explorer that calls this server as you.    |
| Settings  | API keys: create with scopes, rotate with a grace period, revoke. Light, dark or system theme.                                                                        |

The Sia breakdown on an asset comes live from the indexer: every object
(master playlist, variant playlists, media, thumbnails) with its size,
encoded size, slab and sector counts; deduplicated totals (objects packed
together share slabs, and each slab is counted once); data and parity
shards and the redundancy ratio; and the hosts and countries holding the
sectors.

### Signing in

The Studio signs in with GitHub (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`;
set the OAuth callback to `<PUBLIC_URL>/api/v1/auth/github/callback` and
`PUBLIC_URL` to the Studio origin). Each GitHub account is its own tenant.
For local development without OAuth, `AUTH_DISABLED=true` signs every request
in as a `dev` user; the backend refuses to start with it in production.

### Direct-from-Sia in the Studio

Set `VITE_SLUBY_SIA_INDEXER_URL`, `VITE_SLUBY_SIA_APP_ID` and
`VITE_SLUBY_SIA_APP_KEY` (see `frontend/.env.example` and
[Direct-from-Sia playback](#direct-from-sia-playback)) and the asset player
streams straight from Sia hosts; the badge under the player shows which path
a load took.

### Using the SDK

```ts
import { SlubyClient } from '@sluby/sdk';

const client = new SlubyClient({
  apiKey: 'sluby_your_api_key',
  baseUrl: 'http://localhost:8080',
});

const upload = client.uploads.upload(file, {
  title: 'My Video',
  accessTier: 'public',
  onProgress: (pct) => console.log(`${pct}%`),
});
const videoAssetId = await upload.assetId;
await upload;

const asset = await client.assets.waitForReady(videoAssetId);
```

```tsx
import { SlubyPlayer } from '@sluby/player';

<SlubyPlayer client={client} assetId={asset.id} />;
```

The Studio's Developer page has more snippets, in JavaScript and curl,
pointed at your own server.

## API reference

The REST API is described by an OpenAPI 3.1 document, served by the backend:

- Spec (JSON): `http://localhost:8080/api/v1/openapi.json`
- Interactive reference: `http://localhost:8080/api/v1/docs`, which sends
  requests to the same server with your API key

The docs site renders the same document as an
[API reference](./docs/api/reference.md), next to an
[API overview](./docs/api/index.md) of keys and scopes, pagination, errors and
rate limits. Its copy lives in `docs/public/openapi.json`; after changing
`backend/src/api/openapi.ts`, run `npm run openapi:export --workspace=backend`
(a backend test fails while the copy is stale).

Programmatic calls authenticate with a `Bearer` API key; each key carries
`upload`, `read`, and `manage` scopes. Asset listing uses cursor pagination
(pass the `next_cursor` from one page back as `?cursor=` for the next).

## Architecture

One backend process runs the REST API, the tus upload server, the delivery gateway and the BullMQ workers, behind an nginx front door that serves the Studio and caches delivery. PostgreSQL holds metadata and the map from Sia objects to assets; Redis holds the job queues.

An upload arrives over tus, FFmpeg transcodes it into a ladder of fMP4 HLS renditions (one byte-ranged `data.m4s` per rendition), and the output goes to Sia in three packed uploads: the media and thumbnails, then the variant playlists rewritten to point at the media's object ids, then the master playlist. Playback either goes through the gateway, which downloads byte ranges from Sia on demand, or straight from Sia in the browser with short-lived share URLs, using the same stored manifests.

The [architecture docs](./docs/architecture/index.md) cover each part with diagrams: the upload pipeline, both playback paths, deletion and reconciliation, the data model, auth and tenancy, and SDK integration patterns.

## Direct-from-Sia playback

By default the player fetches HLS bytes from the delivery gateway. It can
instead stream them straight from Sia in the browser, with the backend out of
the byte path (the model the proposal describes: the client retrieves content
directly from Sia, no intermediary handles the playback data).

Two modes, from one stored manifest (objects are referenced as
`/v1/objects/{id}`, so no re-processing to switch):

- **Direct from Sia** (default when a viewer identity is configured): the
  player asks the backend for a short-lived, per-object share map (the public
  `GET /v1/share/:id`, gated like the gateway by the playback URL's own
  signature, so no API key is needed), then a custom hls.js loader resolves each
  object and downloads its byte ranges from Sia. The backend serves only the
  small share-map JSON.
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
const client = new SlubyClient({ baseUrl, sia: { indexerUrl, appId, appKey } });
// no api key: <SlubyPlayer src={client.playback.streamUrl(id)} client={client} assetId={id} />
// streams directly from Sia; for a private asset pass a signed url as src.
```

Trade-offs: egress is paid by the downloading account, so direct mode moves
egress to the viewer account (fund it) and has no shared proxy cache (each
viewer pulls independently); use gateway mode for the shared cache. A share URL
carries the object's decryption key and bypasses the signed-URL gateway, so the
backend mints them short-lived, only for a public asset or a valid signed URL,
and never past that signature's expiry (shorter and non-cacheable for private
or signed-policy assets).

Verify the data path with `node scripts/e2e-sia-share.mjs` (opt-in; set the
`SIA_E2E_*` vars it prints when skipped). For the browser, run the quickstart
with the viewer config, open DevTools' Network tab filtered to your backend
origin, and confirm that during playback the manifest and segments do **not**
hit the backend's `/v1/objects` (they go to Sia hosts); with a playback URL the
only backend call is `GET /v1/share/:id`. One exception: the
`<video poster>` thumbnail is always served via the gateway, so you will see a
single `/v1/objects/{thumbnail}` request for it. Unset the viewer config to see
the manifest and segment requests reappear on `/v1/objects` (the gateway
fallback).

## Project layout

```
backend/          Node.js backend (Express + BullMQ + Drizzle + @siafoundation/sia-storage)
frontend/         Studio (Vite + React + shadcn/ui)
packages/sdk/     @sluby/sdk     TypeScript API client
packages/player/  @sluby/player  SlubyPlayer + hooks
examples/         react (quickstart) and plain javascript (vanilla) apps using the sdk and player
docs/             documentation site (VitePress)
nginx/            web front door: Studio, api proxy and object cache
deploy/           Caddyfile for the production override
docker-compose.yml       the stack: postgres, redis, backend, web
docker-compose.prod.yml  production override: Caddy TLS, required secrets
docker-compose.sia.yml   optional self-hosted indexd, walletd and miner on Zen
```

## Tests

```bash
npm test --workspace=backend
npm test --workspace=@sluby/sdk
npm test --workspace=@sluby/player
npm test --workspace=sluby-frontend
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE).

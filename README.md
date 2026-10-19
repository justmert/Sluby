# Sluby

Self-hosted video hosting that stores its media on the Sia network.

Sluby takes a source video, transcodes it into adaptive HLS, stores the output on [Sia](https://sia.tech) through the official `@siafoundation/sia-storage` SDK, and plays it back either straight from Sia hosts in the browser or through a byte-range gateway in the backend.

## What it does

- **Resumable uploads** over the tus protocol, from the Studio, the SDK or any tus client.
- **Adaptive HLS transcoding**: FFmpeg encodes 1080p, 720p, 540p and 360p fMP4 renditions (1440p and 2160p optional), with 6 second segments. Each rendition is one byte-ranged `data.m4s` file holding its init section and every segment. 10-bit, 4:2:2 and HDR sources are converted to 8-bit SDR.
- **Storage on Sia**: the renditions, thumbnails and playlists of a video go to Sia in three packed uploads (the media and thumbnails, then the variant playlists, then the master playlist), and every stored object is addressed by its Sia object id. Each object the pipeline pins is recorded before the pin, so a failed or deleted upload never leaves objects pinned without a record.
- **Two playback paths** from the same stored manifests: direct from Sia in the browser, using short-lived share URLs and the Sia SDK's WebAssembly build, or through the backend gateway, which downloads byte ranges from Sia on demand. Private videos play through signed URLs that expire (one hour by default, six at most) and can be revoked per video.
- **REST API** with a served OpenAPI 3.1 document: scoped API keys (`upload`, `read`, `manage`), cursor paging, playback ids, webhooks with signed and timestamped deliveries, and a per-video breakdown of how its objects are stored on Sia.
- **Reconciliation**: a scheduled job compares the database with the indexer's pinned objects and reports drift (objects pinned but not recorded, or recorded but missing).
- **`@sluby/sdk` and `@sluby/player`**: a TypeScript API client and a React player with an hls.js loader for direct-from-Sia playback.
- **Studio**: a web app for uploading, following processing, browsing the library, inspecting each video's Sia storage, playing videos, and managing API keys and webhooks.

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

Open `http://localhost:8080`, upload a video in the Studio and play it. The [quickstart guide](./docs/guide/quickstart.md) walks through each step and says how long each one took in our runs, and the [production guide](./docs/guide/production.md) covers TLS, GitHub sign-in and connecting to an indexer on mainnet or the Zen testnet.

The documentation site lives in `docs/`:

```bash
npm ci --prefix docs
npm run docs:dev
```

### Local development

Run PostgreSQL and Redis from Compose and the backend and Studio from source (Node.js 22.23.2+, 24.18.1+ or 26.5.1+ and FFmpeg 5+ on the host; HDR sources need an FFmpeg built with zimg, which Homebrew's is not):

```bash
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

# the dev override publishes the databases on 5433 and 6380
export DATABASE_URL=postgresql://sluby:sluby@localhost:5433/sluby
export REDIS_URL=redis://localhost:6380
export PUBLIC_URL=http://localhost:5173

# create the tables once, and again after pulling new migrations
npm run db:migrate --workspace=backend
npm run dev

# in another terminal
npm run dev:frontend
```

Open the Studio at `http://localhost:5173`. Vite proxies `/api` and `/v1` to the backend on port 3000 (`STUDIO_API_PROXY_TARGET` overrides it), so the Studio and the API share one origin and the sign-in cookie reaches every request, including tus uploads.

| How you start it        | API base URL            |
| ----------------------- | ----------------------- |
| `docker compose up -d`  | `http://localhost:8080` |
| `npm run dev` (backend) | `http://localhost:3000` |
| `npm run dev:frontend`  | `http://localhost:5173` |

## Studio

The Studio (`frontend/`) is the management UI. It is built with Vite, React and shadcn/ui, talks to the API through `@sluby/sdk`, and plays video with `@sluby/player`, the same packages an app would use.

| Page      | What it does                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Asset totals by status, bytes stored on Sia, latest uploads and a health summary. Admins also see the indexer account, storage, the gateway cache and the last reconciliation run.                                                      |
| Upload    | Drag and drop, resumable tus upload with byte and chunk progress, pause, resume and cancel, then the processing pipeline stage by stage with its log and a retry. Unfinished uploads from an earlier visit can be resumed or discarded. |
| Assets    | Server-side search (title, description or id), status and access filters, sorting, grid and list views, bulk delete.                                                                                                                    |
| Asset     | Embedded player with a rendition picker and the delivery path (direct from Sia or gateway), the rendition ladder, and the Sia breakdown described below.                                                                                |
| Player    | The library's ready videos in a paged list, played with `@sluby/player`.                                                                                                                                                                |
| Developer | Copy-ready JavaScript and curl snippets for common tasks (checked against the SDK and the OpenAPI document in tests), webhooks with a test send and a delivery log, and an API explorer that calls this server as you.                  |
| Analytics | The library by status, and for admins the server's metrics: gateway throughput and responses, cache and queues.                                                                                                                         |
| Members   | For admins: members with their roles and sign-in methods, change a role, remove and restore, reset links, and invite links.                                                                                                             |
| Settings  | API keys: create with scopes, rotate with a grace period, revoke, and who created each. Sign-in methods (change password, link GitHub), Studio sessions, and light, dark or system theme.                                               |

The Sia breakdown on an asset comes live from the indexer: every object (master playlist, variant playlists, media, thumbnails) with its size, encoded size, slab and sector counts; deduplicated totals (objects packed together share slabs, and each slab is counted once); data and parity shards and the redundancy ratio; and the hosts and countries holding the sectors.

### Signing in

One install is one team's workspace: every member sees every video, key and webhook, and each has a role, admin or member. On a fresh install the backend logs a setup code, and whoever runs the server uses it in the Studio to create the first admin; everyone else joins through single-use invite links an admin makes on the Members page. People sign in with an email and password, or with GitHub when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set (OAuth callback `<PUBLIC_URL>/api/v1/auth/github/callback`); GitHub only signs in people who are already members or have an invite. Admins also see the server's operations data and manage members. There is no email: a forgotten password gets a reset link from an admin, or from `npm run admin:reset-link --workspace=backend -- --email <email>` on the server. For local development, `AUTH_DISABLED=true` signs every request in as a local admin; the backend refuses to start with it in production. See [accounts and roles](./docs/architecture/auth-and-tenancy.md).

### Direct-from-Sia in the Studio

Set `VITE_SLUBY_SIA_INDEXER_URL`, `VITE_SLUBY_SIA_APP_ID` and `VITE_SLUBY_SIA_APP_KEY` (see `frontend/.env.example` and [Direct-from-Sia playback](#direct-from-sia-playback)), rebuild the `web` image, and the asset player streams straight from Sia hosts; the badge under the player shows which path a load took.

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

Keep API keys on your server: a page that plays public videos needs no key, and a private video plays from a signed URL your server mints. The [JavaScript](./docs/guide/javascript.md) and [React](./docs/guide/react.md) guides show both, and the Studio's Developer page has more snippets, in JavaScript and curl, pointed at your own server.

## API reference

The REST API is described by an OpenAPI 3.1 document, served by the backend:

- Spec (JSON): `http://localhost:8080/api/v1/openapi.json`
- Interactive reference: `http://localhost:8080/api/v1/docs`, which sends requests to the same server with your API key

The docs site (`npm run docs:dev`, see above) renders the same document as an API reference page, next to an [API overview](./docs/api/index.md) of keys and scopes, pagination, errors, rate limits and webhooks. Its copy lives in `docs/public/openapi.json`; after changing `backend/src/api/openapi.ts`, run `npm run openapi:export --workspace=backend` (a backend test fails while the copy is stale).

Programmatic calls authenticate with a `Bearer` API key; each key carries `upload`, `read` and `manage` scopes. A `read` key can mint signed URLs for private videos, so treat every key as a server-side secret. Listings use cursor paging (pass the `next_cursor` of one page back as `?cursor=` for the next).

## Architecture

One backend process runs the REST API, the tus upload server, the delivery gateway and the BullMQ workers, behind an nginx front door that serves the Studio and proxies the API and delivery. PostgreSQL holds metadata and the map from Sia objects to assets; Redis holds the job queues and the leases that keep slab prunes away from uploads in flight.

An upload arrives over tus, FFmpeg transcodes it into a ladder of fMP4 HLS renditions, and the output goes to Sia in three packed uploads. Playback either goes through the gateway, which downloads byte ranges from Sia on demand, or straight from Sia in the browser with short-lived share URLs, using the same stored manifests.

The [architecture docs](./docs/architecture/index.md) cover each part with diagrams: the upload pipeline, both playback paths, deletion and reconciliation, the data model, accounts and roles, and SDK integration patterns.

## Direct-from-Sia playback

By default the player fetches HLS bytes from the delivery gateway. It can instead stream them straight from Sia in the browser, with the backend out of the byte path: the client retrieves the content from Sia hosts itself.

Two modes, from one stored manifest (objects are referenced as `/v1/objects/{id}`, so nothing is processed again to switch):

- **Direct from Sia** (the default when a viewer identity is configured): the player asks the backend for a short-lived, per-object share map (the public `GET /v1/share/:id`, gated like the gateway by the playback URL's own signature, so no API key is needed), then a custom hls.js loader resolves each object and downloads its byte ranges from Sia. The backend serves only the small share-map JSON.
- **Gateway** (fallback): used for Safari's native HLS, when no viewer identity is configured, or if the Sia session fails to start.

Enable it by provisioning a low-privilege viewer identity once (separate from the uploader's key, safe to publish like a public playback key):

```bash
cd backend
SIA_INDEXER_URL=https://sia.storage npm run provision-viewer
```

Approve the printed URL in your indexer account; it prints three publishable values. Pass them to the client (or set `VITE_SLUBY_SIA_*` in the quickstart):

```ts
const client = new SlubyClient({ baseUrl, sia: { indexerUrl, appId, appKey } });
// no api key: <SlubyPlayer src={client.playback.streamUrl(id)} client={client} assetId={id} />
// streams directly from Sia; for a private asset pass a signed url as src.
```

Trade-offs: egress is paid by the downloading account, so direct mode moves egress to the viewer account (fund it), and every viewer downloads from Sia on their own. The gateway does not share segment downloads between viewers either: media is read with byte ranges, and nginx caches neither ranged reads nor anything for longer than a minute, so its cache only spares Sia repeated manifest and thumbnail reads. A share URL carries the object's decryption key and bypasses the signed-URL gateway, so the backend mints them short-lived, only for a public asset or a valid signed URL, and never past that signature's expiry (shorter and not cacheable for private assets and signed playback ids).

Verify the data path with `node scripts/e2e-sia-share.mjs` (opt-in; set the `SIA_E2E_*` variables it prints when skipped). For the browser, run the quickstart with the viewer config, open DevTools' Network tab filtered to your backend origin, and confirm that during playback the manifest and segments do **not** hit the backend's `/v1/objects` (they go to Sia hosts); with a playback URL the only backend call is `GET /v1/share/:id`. One exception: the `<video poster>` thumbnail is always served through the gateway, so you will see a single `/v1/objects/{thumbnail}` request for it. Unset the viewer config to see the manifest and segment requests come back to `/v1/objects` (the gateway fallback).

## Project layout

```
backend/          Node.js backend (Express, BullMQ, Drizzle, @siafoundation/sia-storage)
frontend/         Studio (Vite, React, shadcn/ui)
packages/sdk/     @sluby/sdk     TypeScript API client
packages/player/  @sluby/player  SlubyPlayer, hooks and the direct-from-Sia hls.js loader
examples/         react (quickstart) and plain javascript (vanilla) apps using the sdk and player
docs/             documentation site (VitePress)
nginx/            web front door: Studio, api and delivery proxy, rate limits
deploy/           Caddyfile for the production override
scripts/          package checks, the compose stack check, the release gate, the share e2e
docker-compose.yml       the stack: postgres, redis, backend, web
docker-compose.prod.yml  production override: Caddy TLS, required secrets
docker-compose.dev.yml   publishes postgres and redis for running the backend from source
docker-compose.sia.yml   optional self-hosted indexd, walletd and miner on Zen
```

## Tests

```bash
npm test --workspace=backend
npm test --workspace=@sluby/sdk
npm test --workspace=@sluby/player
npm test --workspace=sluby-frontend
```

The backend's database and queue tests need PostgreSQL and Redis, and the FFmpeg integration test needs FFmpeg; without them those tests skip. [CONTRIBUTING.md](./CONTRIBUTING.md#running-the-tests) explains how to run every suite, including the browser suites.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](./LICENSE).

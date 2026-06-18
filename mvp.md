# SiaStream — MVP Specification

**Decentralized video streaming on Sia.**

SiaStream is a developer-focused video infrastructure platform that takes a
source video file, transcodes it into adaptive HLS, stores every output
artifact on the Sia network via the `sia-storage` SDK, and serves playback
through a byte-range-aware HTTP gateway. It ships with a REST API, a
TypeScript SDK, a React player component, and a management Studio.

The goals of the MVP are to prove that a modern video platform —
resumable uploads, ABR transcoding, range streaming, embed players — can
run end-to-end against Sia as the primary object store without sacrificing
the UX developers expect from centralised providers.

---

## 1. Product summary

### What a user gets

| Capability | Surface |
| --- | --- |
| Resumable, chunked video uploads up to 10 GB | TUS over REST (`/api/v1/uploads`) |
| Multi-rendition HLS transcoding (1080p/720p/540p/360p) | Backend pipeline |
| Object-addressable storage on Sia (Zen testnet or mainnet) | `sia-storage` + `@siafoundation/sia` SDKs |
| Range-streamed playback with local LRU cache | `/v1/objects/:id` + `/v1/stream/:id/master.m3u8` |
| Programmatic asset, upload, playback & webhook management | REST + `@siastream/sdk` |
| Drop-in React player | `<SiaStreamPlayer />` from `@siastream/react` |
| Operator Studio (dashboard, uploader, asset/player pages) | `frontend/` Vite + React app |
| Webhook delivery with HMAC signing + retries | Per-endpoint secret + delivery log |
| Observability | Prometheus metrics, per-asset Sia breakdown, processing logs |

### Access tiers

A `VideoAsset` has one of two access tiers:

* **public** — anyone who knows the asset id can stream it via the gateway.
* **private** — identical delivery model for the MVP; the tier is persisted
  in Postgres so API keys can be filtered and future delivery-layer gating
  can hook in without migrations.

### Scope boundaries (MVP)

Deliberately out of scope:

* Monetisation (no payments, no paywall)
* Viewer identity or end-user auth (access control is API-key scoped, not
  viewer scoped)
* DRM / content encryption at rest (objects rely on Sia's slab encryption;
  the MVP doesn't add a second content-key layer)
* Live / RTMP ingest (batch VOD only)
* Analytics beyond the built-in dashboards (no external attribution)

---

## 2. System architecture

```
                                                    ┌───────────────────┐
                                                    │  Sia indexer      │
                                                    │  (zen.siascan.com │
                                                    │   or custom)      │
                                                    └────────▲──────────┘
                                                             │
                                                             │ sia-storage
                                                             │ + @siafoundation/sia
                                                             │ (NAPI → Rust SDK)
                                                             │
 ┌────────┐   TUS   ┌────────────────┐ BullMQ ┌───────────────┴───┐
 │ Client ├────────▶│  Express API   ├───────▶│  Queue workers    │
 └────────┘         │  + TUS server  │ Redis  │  transcode →      │
                    │                │        │  upload-segments →│
                    │                │        │  finalize         │
                    │                │        └──────────┬────────┘
                    │                │                   │
                    │                │◀──────────────────┘
                    └──┬─────────────┘    updates + webhooks
                       │
                       │ playback URLs
                       ▼
 ┌────────┐          ┌────────────────┐    range fetch   ┌──────────────┐
 │ Player │──────────▶│ Nginx proxy   │─────────────────▶│ Aggregator   │──▶ Sia
 │ (hls.js)│         │  (+ microcache)│                  │ (/v1/objects)│    (byte ranges)
 └────────┘          └────────────────┘                  └──────────────┘
```

### Components

1. **Express HTTP server** (`backend/src/index.ts`) — mounts the REST API,
   TUS server, delivery gateway, health/metrics, and wires all
   dependency-injected route factories together.
2. **PostgreSQL** (via Drizzle ORM, `postgres` driver) — canonical store
   for assets, upload sessions, processing jobs, API keys, webhooks.
3. **Redis** — BullMQ queues and ephemeral rate-limit counters.
4. **BullMQ workers** — three queues (`transcode`, `upload-segments`,
   `finalize`) consumed by the same process via `new Worker(...)`. The
   workers are concurrency-bounded to match FFmpeg and Sia host-pool
   capacity.
5. **FFmpeg / ffprobe** — CLI processes spawned by the transcode worker.
6. **Sia SDKs** — two official Sia Foundation TypeScript SDKs
   (`sia-storage` for control plane, `@siafoundation/sia` for the
   data plane). Each wraps the Rust `sia-sdk-rs` via NAPI bindings.
7. **Nginx** — reverse-proxies the HTTP API and adds a small
   microcache in front of the aggregator for hot segments.
8. **Frontend Studio** — Vite + React 19 SPA talking to the REST API with
   an API key stored in `localStorage`.

### Process topology (Docker Compose)

`docker-compose.yml` (baseline):

* `postgres` — managed state.
* `redis` — queue + rate-limit state.
* `backend` — the single Node.js process running API + workers + TUS.
* `nginx` — TLS termination (in prod via `docker-compose.prod.yml`) and a
  microcache for `/v1/objects/*`.

`docker-compose.sia.yml` (optional, for Zen testnet self-hosting):

* `indexd` — Sia indexer daemon.
* `walletd` — wallet service (used by the miner to publish blocks).
* `cpuminer` — SiaFoundation/cpuminer, single-threaded, pays out to
  `indexd`'s wallet address so contracts can be formed.

In development the stack can either point `SIA_INDEXER_URL` at the public
testnet indexer (`https://zen.sia.storage` / custom) or at the local
compose stack. The backend does not care which — the two SDKs are the only
way it talks to Sia.

---

## 3. Data model

All tables live in a single Postgres schema, declared in
`backend/src/db/schema.ts` and materialised by Drizzle migrations
(`backend/drizzle/0000_init.sql`).

### `video_assets`

Source of truth for video metadata and its Sia object references.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk | API-visible asset id |
| `title` | `text` | User supplied |
| `description` | `text` | Defaults `''` |
| `manifest_object_id` | `text` nullable | Sia object id of the master HLS playlist |
| `thumbnail_object_ids` | `text[]` | 25/50/75% extracted thumbnails |
| `sia_object_ids` | `jsonb` | Flat list of every pinned object (manifest, playlists, data files, thumbnails) |
| `segment_count` | `integer` | Derived from parsing variant playlists |
| `total_storage_bytes` | `bigint` | Sum of data file sizes |
| `duration_ms`, `resolution` | `bigint`, `text` | From `ffprobe` |
| `access_tier` | enum `public` / `private` | |
| `creator_address` | `text` | API key's creator address |
| `status` | enum `created` / `uploading` / `processing` / `ready` / `failed` | State machine |
| `created_at`, `updated_at` | `timestamptz` | |

### `upload_sessions`

One row per TUS session. Links back to the `video_asset` it fills.

Key columns: `video_asset_id`, `upload_url`, `file_path`, `file_size`,
`uploaded_bytes`, `sha256_hash`, `status`
(`uploading`/`completed`/`cancelled`/`failed`), `metadata` (jsonb), and
timestamps.

### `processing_jobs`

One row per asset's end-to-end pipeline run. Mirrors BullMQ state for
durable queries.

Tracks `status`, `progress_percent`, `error_message`, start/complete
timestamps, retry counts, and an append-only `logs` jsonb array of
`{ timestamp, stage, message }` entries consumed by the Studio's
processing timeline UI.

### `api_keys`

Hashed developer credentials. Raw keys are shown once at creation; lookup
is by SHA-256 hash.

Fields: `key_hash` (unique), `name`, `scopes` (`upload`/`read`/`manage`
subset), `rate_limit` (req/min), `creator_address`, `is_active`,
`expires_at`, timestamps.

### `webhook_endpoints` / `webhook_deliveries`

* `webhook_endpoints` — URL, subscribed event list, HMAC secret, bound to
  an API key.
* `webhook_deliveries` — every attempt: payload, status code, response
  body, retry counter, timestamps. Used for retries and audit.

### Enums

`upload_status`, `video_status`, `access_tier`, `job_status` — all
PostgreSQL enums, declared once in the schema module.

---

## 4. Upload pipeline

### Stage 1 — create + TUS

1. Client calls `POST /api/v1/uploads` (or SDK `client.uploads.create(...)`).
   Body: `{ title, description?, access_tier? }`. Response:
   `{ video_asset_id, upload_url }`.
2. The server inserts a `video_assets` row (status `created`) and a paired
   `upload_sessions` row, then returns the TUS upload URL.
3. The client streams the file via the TUS protocol to
   `/api/v1/uploads/:sessionId`. Chunks are 5 MiB; `tus-js-client` handles
   pause/resume and exponential retry.
4. The TUS server (`backend/src/upload/tus-server.ts`) validates the
   bearer token on every non-OPTIONS request, verifies the signalled
   `Content-Length` against `MAX_UPLOAD_SIZE`, and writes chunks to the
   local `UPLOAD_DIR` via `@tus/file-store`.
5. On `onUploadFinish` it streams the file through a SHA-256 hash (full
   file, not chunk-wise), marks the upload session `completed`, and
   enqueues a BullMQ `transcode` job.

Design notes:

* TUS is preferred over a plain multipart upload because resumability and
  back-pressure matter for 1–10 GB source files on residential uplinks.
* The TUS server is mounted **before** the Express API router so that
  the upload route can intercept raw `PATCH` bodies without body parsing
  interference.

### Stage 2 — transcode worker

File: `backend/src/queue/processors.ts` + `backend/src/transcode/`.

1. The worker calls `ffprobe` to extract duration, resolution, framerate,
   and audio presence.
2. It then spawns a single `ffmpeg` process that emits **four renditions
   in one pass** via `filter_complex` split + per-variant `scale` and
   `pad`, producing CMAF-style fMP4 HLS.
3. Key flags:
   * `-preset ultrafast` — prioritise wall-clock, not bitrate efficiency;
     MVP is about end-to-end correctness, not encoder tuning.
   * `-hls_flags independent_segments+single_file` — **each variant is a
     single `data.m4s`** containing the init segment + every media segment
     concatenated. The variant playlist references them via
     `EXT-X-BYTERANGE`. This is the core design choice that makes the Sia
     delivery path efficient (see §6).
   * `-hls_time 6` — ~6 s segments.
   * `-force_key_frames 'expr:gte(t,n_forced*2)'` + `-sc_threshold 0` —
     2 s GOPs for clean ABR switching.
   * `-hls_segment_type fmp4 -hls_playlist_type vod` — fMP4 VOD output.
4. Progress is parsed from `ffmpeg` stderr `time=HH:MM:SS.cs` lines and
   scaled to 0–60% of overall pipeline progress.
5. A separate `thumbnail-extractor.ts` spawns three `ffmpeg` processes in
   parallel at 25/50/75% of duration → three JPEGs on disk.
6. The worker enqueues an `upload-segments` job with the output directory
   and thumbnail paths.

Concurrency: `concurrency: 2`, rate-limited to 4 jobs per 60 seconds per
worker. FFmpeg dominates CPU, so higher parallelism would thrash.

### Stage 3 — upload-segments worker

File: `backend/src/storage/segment-uploader.ts`.

The per-video Sia operation budget is tuned aggressively:

```
N variants (data files)  +  1 packed batch  +  1 master  =  N + 2 ops
For the 4-rung ladder + 3 thumbnails: 4 + 1 + 1 = 6 Sia ops per video.
```

1. **Parse the master playlist** to discover the 4 variant directories.
2. **Upload each variant's single `data.m4s`** (`uploadAndPin`) in
   parallel (default concurrency 3, tunable via `SIA_UPLOAD_CONCURRENCY`).
   Large files cleanly fill their own slabs — there is no benefit to
   packing them.
3. **Rewrite each variant playlist** — replace the bare `data.m4s` URI
   on `EXT-X-MAP` and each `EXTINF` reference with the gateway URL
   `/v1/objects/<sia-object-id>`, preserving `BYTERANGE` offsets exactly.
4. **Pack the 4 rewritten playlists + the 3 thumbnails into one
   `uploadAndPinPacked` call** — many small items share a slab, slashing
   host-stream count versus naive one-by-one uploads.
5. **Rewrite the master playlist** to point each variant's
   `#EXT-X-STREAM-INF` at its new playlist object id.
6. **Upload the master separately** (must be last: it depends on the
   packed batch's output ids).
7. Enqueue a `finalize` job.

### Stage 4 — finalize worker

1. Update the `video_assets` row: set `manifest_object_id`,
   `thumbnail_object_ids`, `sia_object_ids`, `duration_ms`, `resolution`,
   `segment_count`, `total_storage_bytes`, and `status = 'ready'`.
2. Mark the `processing_jobs` row `completed` at 100%.
3. Dispatch the `asset.ready` webhook to every registered endpoint that
   subscribes to it.
4. Remove the local transcode output directory.

### Failure handling

* All three workers use BullMQ's `attempts: 3` with exponential
  back-off. On the final failure the `processing_jobs` row is set to
  `failed`, the asset's `status` is set to `failed`, and a
  `processing.failed` webhook is fired.
* A manual retry endpoint (`POST /api/v1/assets/:id/retry`) re-enqueues
  the correct stage based on the asset's current state.

---

## 5. Sia storage layer

File: `backend/src/storage/sia-client.ts`.

### Two-SDK architecture

The Sia Foundation publishes two TypeScript packages; they're used for
the operations each does best:

| SDK | Role in SiaStream |
| --- | --- |
| `sia-storage` | Control plane: `connect`, `pinObject`, `object`, `deleteObject`, `shareObject`, `pruneSlabs`. The indexer speaks the signing format this SDK emits. |
| `@siafoundation/sia` | Data plane: `uploadPacked.add(buffer)` / `.finalize()` + `download(object, opts)` with native byte-range support. |

A single `DualSdk` singleton lazily initialises both SDKs with the same
`AppKey`. After a packed upload completes, object handles are
**bridged** between SDKs using each SDK's own
`seal(appKey)` → JSON → `PinnedObject.open(appKey, sealed)` round-trip;
`bridgeToStorageObject()` handles the `Buffer` / `base64` and
`Date` / Unix-seconds format differences between the two
serialisations.

### Upload primitives

* **`uploadAndPin(data: Uint8Array)`** — one-off upload. Internally:
  1. `uploadSdk.uploadPacked({ dataShards, parityShards, maxInflight })`.
  2. `.add(Buffer.from(data))` → `.finalize()` → first object.
  3. Bridge → `storage.pinObject(storageObj)` to persist the indexer
     pin in the correct signing format.
* **`uploadAndPinPacked(items: Uint8Array[])`** — packs N small files
  into **one** Sia packed upload call, then pins each result
  sequentially. Used for the variant playlists + thumbnails batch so
  they can share slabs.

### Shard configuration

Erasure-coding parameters are env-tunable to match the host pool size:

```
SIA_DATA_SHARDS   (default 3)
SIA_PARITY_SHARDS (default 9)
SIA_MAX_INFLIGHT  (default 12)
```

On Zen testnet with ~12–13 contracted hosts, the `3+9` scheme fills
every host with one sector per slab. Mainnet deployments with larger
host pools can widen the coding without code changes.

### Download path

`downloadObject(id, { offset?, length? })` hands off to
`uploadSdk.download(...)` for the actual byte transfer — that SDK's
download call returns the decoded bytes directly and supports native
range requests. The storage SDK's object handle is bridged into the
upload SDK's PinnedObject type for the call, using `importToSiaA()` to
rewrite the sealed JSON into the upload SDK's expected format
(Date → Unix seconds `f64`, Buffer → base64).

### Why this matters for streaming

Sia's slab format already supports native byte-range reads — the indexer
and the SDK download call will only fetch the slabs that overlap the
requested byte range. SiaStream exposes that directly to the player by
never buffering a full file in the gateway (see §6).

---

## 6. Delivery gateway

Files: `backend/src/delivery/aggregator.ts`, `cache-manager.ts`,
`manifest-server.ts`; plus `backend/src/storage/blob-manager.ts` for the
in-memory LRU cache.

The gateway is mounted at `/` (outside `/api/v1`) and exposes three
routes:

1. **`GET /v1/objects/:objectId`** — generic object fetch, chooses a
   strategy based on request shape:
   * **`Range: bytes=N-M` header present** → **range-passthrough**:
     * Call `getObject(id)` for metadata only (one cheap indexer HTTP).
     * Parse `Range` against the real `totalSize`.
     * Call `downloadObject(id, { offset, length })` — Sia fetches only
       the overlapping slabs and returns the decoded bytes.
     * Respond `206 Partial Content` with `Content-Range`,
       `Accept-Ranges: bytes`, `Content-Length`. No caching of partial
       bytes (each ranged read is essentially unique).
   * **No range header** → **cache-and-serve** via LRU (cache size
     bounded by `CACHE_MAX_SIZE_MB`). Manifest/thumbnail content
     detected by magic bytes and served with the right `Content-Type`
     (`application/vnd.apple.mpegurl` for playlists; `image/jpeg|png|webp|gif`
     for thumbnails; `application/octet-stream` fallback).
2. **`GET /v1/stream/:videoAssetId/master.m3u8`** — convenience for
   players: look up the asset's master manifest object id by UUID and
   serve it via the cache path.
3. **`GET /v1/cache/stats`** — debug endpoint returning cache hit/miss
   counters.

### Why range-passthrough matters

Combined with FFmpeg's `single_file` HLS output, range-passthrough means:

* For a 2 GB video where the viewer watches one minute, only ~1 minute
  of bytes is pulled from Sia, not 2 GB.
* First-frame latency is one slab fetch (~1–2 s), not a full-file
  download (~30 s+).
* Nginx sits in front with a small microcache so repeat ranges stay
  warm at the edge without pulling Sia on every scrub.

### CORS

Every delivery response sets `Access-Control-Allow-Origin: *` plus the
headers HLS.js and `<video>` elements need
(`Content-Length`, `Content-Range`, `Accept-Ranges`).

---

## 7. REST API surface

Mounted at `/api/v1/*`. All routes require a bearer API key except
`/health`, Prometheus `/metrics`, and the delivery gateway.

### Middleware

* **Rate limiting** — sliding-window counter per API key id in Redis,
  default 100 req/min (overridable per key).
* **API-key auth** — SHA-256 hash lookup, injects `req.apiKey =
  { id, creatorAddress, scopes }`.
* **`requireScope(scope)`** — per-route scope enforcement.

### Routes

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/uploads` | `upload` | Create upload session, return TUS URL |
| PATCH/HEAD/POST | `/api/v1/uploads/:sid` | (TUS) | Chunked upload |
| GET | `/api/v1/assets` | `read` | Paginated asset list with filters (`status`, `access_tier`) |
| GET | `/api/v1/assets/:id` | `read` | Single asset metadata |
| PATCH | `/api/v1/assets/:id` | `manage` | Update title / description / access tier |
| DELETE | `/api/v1/assets/:id` | `manage` | Delete asset |
| GET | `/api/v1/assets/:id/processing` | `read` | Job status + log timeline |
| POST | `/api/v1/assets/:id/retry` | `manage` | Re-enqueue a failed stage |
| GET | `/api/v1/assets/:id/sia` | `read` | Rich Sia-side breakdown (see §9) |
| GET | `/api/v1/playback/:id` | `read` | Returns a relative playback URL + poster + metadata |
| GET | `/api/v1/playback/:id/signed` | `read` | Time-limited signed playback URL |
| GET | `/api/v1/webhooks` | `manage` | List webhook endpoints |
| POST | `/api/v1/webhooks` | `manage` | Create endpoint |
| DELETE | `/api/v1/webhooks/:id` | `manage` | Delete endpoint |
| GET | `/api/v1/webhooks/:id/deliveries` | `manage` | Delivery history |
| POST | `/api/v1/keys` | `manage` | Create API key (raw returned once) |
| GET | `/api/v1/keys` | `manage` | List keys (no raw) |
| DELETE | `/api/v1/keys/:id` | `manage` | Revoke key |
| GET | `/api/v1/metrics` | any | JSON metrics snapshot |
| GET | `/metrics` | public | Prometheus scrape endpoint |
| GET | `/health` | public | Liveness probe |

### Error envelope

Errors bubble up through `express-async-errors` and `AppError`; the
error-handler middleware serialises them to:

```json
{ "error": "Video asset not found", "code": 404 }
```

---

## 8. TypeScript SDK (`@siastream/sdk`)

The SDK is a thin-but-typed wrapper around the REST API with four
sub-managers:

* `SiaStreamClient({ apiKey, baseUrl })` — root client.
* `client.uploads` — `create()`, `uploadFile(uploadUrl, file, opts)`.
  Wraps `tus-js-client`; handles chunking, retries, and progress events.
* `client.assets` — `list()`, `get()`, `update()`, `delete()`,
  `waitForReady(id)` (polls `/assets/:id` until `status === 'ready'` or
  times out).
* `client.playback` — `get(id)`, `getSigned(id, expiresIn)`.
* `client.webhooks` — full CRUD + delivery history.

Error surface: `SiaStreamError` (base), plus `AuthenticationError`,
`NotFoundError`, `RateLimitError`, `TimeoutError`.

The SDK is fully typed off the same `VideoAsset` / `PlaybackInfo` /
`WebhookEndpoint` / etc. shapes that the backend returns. Built with
`tsc` to both ESM and types.

---

## 9. Asset Sia-breakdown endpoint

`GET /api/v1/assets/:id/sia` returns a rich per-asset summary that
reflects **observed** Sia state, not application-layer configuration.
Shape:

```ts
{
  manifestObjectId: string | null;
  manifest: ObjectSummary | null;       // size, slabCount, sectorCount,
                                        //  minShards, totalShards, hosts
  variants: Array<{
    resolution, bitrateKbps,
    dataObjectId, playlistObjectId,
    dataSize,
    segmentCount,
    hostCount, hosts,
    slabCount, sectorCount,
    encodedBytes: number | null,        // sectors × 4 MiB
    minShards: number | null,           // from slab metadata
    totalShards: number | null,
  }>;
  thumbnails: Array<{ objectId, size }>;
  totals: {
    objectCount, rawBytes,
    encodedBytes: number | null,        // real: sectors × 4 MiB
    redundancyRatio: number | null,     // real: totalShards / dataShards
    dataShards: number | null,
    parityShards: number | null,
    uniqueHostCount, allHosts,
  };
  indexer: { url, network: 'zen' | 'mainnet' };
}
```

Everything except `resolution` and `bitrateKbps` (from the master
manifest) is derived from the SDK's slab metadata on the actual pinned
objects. `encodedBytes` is `sectorCount × 4 MiB` (the Sia protocol
sector size), and redundancy is computed from the first slab with
sectors. The endpoint caches per asset id for 30 s to avoid thrashing
the indexer under UI polling.

---

## 10. Webhooks

Event catalogue: `upload.started`, `upload.completed`, `upload.failed`,
`processing.started`, `processing.progress`, `asset.ready`,
`asset.errored`.

Delivery contract:

* `POST <endpoint.url>` with JSON body `{ event, data, delivered_at }`.
* Header `X-SiaStream-Signature: sha256=<hex>` — HMAC-SHA256 of the
  raw body using the endpoint's secret. The secret is returned once on
  creation.
* Header `X-SiaStream-Delivery: <uuid>` for idempotency.
* Retry policy: three attempts with exponential backoff, recorded in
  `webhook_deliveries` for audit.

Dispatcher location: `backend/src/webhooks/dispatcher.ts`.

---

## 11. Frontend Studio

Vite + React 19 + Tailwind v4 SPA, mounted at `/studio/*`:

| Route | Purpose |
| --- | --- |
| `/studio` | Dashboard: asset totals, storage usage, latest uploads, live cache stats, indexer-network badge. |
| `/studio/upload` | Uploader with TUS progress visualisation, chunk-level state, and post-processing live log timeline. |
| `/studio/assets` | Searchable, filterable grid/list of assets with bulk delete. |
| `/studio/assets/:id` | Asset detail: player embed, Sia-side breakdown widget (from `/assets/:id/sia`), processing-job timeline, metadata editor, delete. |
| `/studio/player` | Standalone test player with bandwidth/latency stat pills and a segment-event timeline. |
| `/studio/developer` | API reference with ready-to-copy curl/JS snippets; API-key management. |
| `/studio/analytics` | Charts (`recharts`): asset counts, duration, storage growth. |
| `/studio/settings` | API key storage, theme toggle. |

### Shared mechanics

* **API client** (`frontend/src/lib/api-client.ts`) — typed `fetch`
  wrapper that prepends `Authorization: Bearer <key>` from
  `localStorage` and throws parsed `{ error, code }` envelopes.
* **React Query** — every read hook uses TanStack Query for caching,
  background refresh, and optimistic mutations.
* **Theme** — Tailwind v4 `@theme` palette swap: the `teal-*` scale is
  remapped to the Sia brand orange (`rgb(255, 121, 26)` as `teal-500`),
  so every existing `teal-*` class renders orange without changing
  component code.
* **Explorer links** — `ExplorerLink` and `ObjectIdBadge` components:
  on-chain entities (host pubkey, contract id, tx id, block, address)
  link to Siascan; renterd object ids are rendered as truncated hex
  with a copy button (they are app-layer hashes and not on-chain).
* **Passcode gate** — a session-level passcode screen gates the whole
  Studio in shared-environment demos.

### React player (`@siastream/react`)

`<SiaStreamPlayer src={masterUrl} autoPlay controls />` — wraps
`hls.js` with graceful Safari fallback to native HLS; exposes a
`SiaStreamPlayerHandle` imperative ref with `play / pause / seek /
getStats`.

---

## 12. Observability

* **Prometheus** — `prom-client` exposes `/metrics` with request
  counters, request-duration histograms, queue-depth gauges, Sia
  upload/download durations, cache hit ratio.
* **Pino logs** — structured JSON in prod, pretty in dev. Correlation
  ids on upload sessions, processing jobs, and Sia object ids.
* **Per-asset processing timeline** — every worker appends stage
  entries (`transcode`, `upload`, `finalize`) to the asset's
  `processing_jobs.logs` column, surfaced as a live timeline on the
  asset detail page.
* **Cache stats endpoint** — `/v1/cache/stats` returns hit/miss
  counters for both the manifest LRU and the segment LRU.

---

## 13. Security model

### Authentication

* API keys are hashed (SHA-256) before persistence; the raw
  `wss_<nanoid>` prefix is the only form shown to the caller and only
  on create.
* Keys carry scopes `upload | read | manage` and a per-key `rate_limit`
  that overrides the global default.
* A `BOOTSTRAP_API_KEY` env var solves the chicken-and-egg problem: if
  the DB has zero keys on startup and the env var is set, the backend
  seeds a full-scope key with that value. Useful for compose demos;
  unset for production.

### Transport

* HTTPS is expected to terminate at the Nginx layer. The TUS server
  respects `X-Forwarded-Proto` so upload URLs stay consistent behind a
  TLS proxy.
* CORS is `*` for the delivery gateway (playback is meant to be
  embeddable); the REST API defaults to reflecting `Origin`.

### Webhook signing

Every webhook POST carries `X-SiaStream-Signature` = HMAC-SHA256 of the
raw JSON body keyed with the endpoint's secret. Receivers must verify
the signature before trusting payload contents.

### Sia keys

`SIA_APP_KEY` is a private Ed25519 key (hex). The key lives only in
backend env and is loaded into both SDKs in-process; it is never sent
to clients. Onboarding (`npm run sia:onboard`) generates the key and
registers it with the indexer; the operator pastes the resulting
`SIA_APP_ID` + `SIA_APP_KEY` into `.env` once.

---

## 14. Configuration (env vars)

All env config is schema-validated at boot by `zod` in
`backend/src/config/env.ts`. Missing/invalid values exit with a clear
message.

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://siastream:siastream@localhost:5432/siastream` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ + rate limiter |
| `SIA_INDEXER_URL` | `https://sia.storage` | Sia indexer base URL (point at Zen, mainnet, or local) |
| `SIA_APP_ID` | (required) | 32-byte hex id from onboarding |
| `SIA_APP_KEY` | (required) | Ed25519 private key (hex) from onboarding |
| `SIA_DATA_SHARDS` | `3` | Reed-Solomon data shards per slab |
| `SIA_PARITY_SHARDS` | `9` | Reed-Solomon parity shards per slab |
| `SIA_MAX_INFLIGHT` | `12` | Concurrent slab uploads per call |
| `SIA_UPLOAD_CONCURRENCY` | `3` | Parallel variant uploads (host-pool bound) |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP server |
| `UPLOAD_DIR` | `./uploads` | TUS datastore |
| `TRANSCODE_OUTPUT_DIR` | `./transcode-output` | Scratch dir for FFmpeg |
| `MAX_UPLOAD_SIZE` | `10 GiB` | TUS hard limit |
| `CACHE_DIR` / `CACHE_MAX_SIZE_MB` | `./cache` / `10240` | LRU bounds |
| `API_RATE_LIMIT_PER_MIN` | `100` | Default per-key limit |
| `BOOTSTRAP_API_KEY` | — | Optional seed key, used only when the DB is empty |

Frontend env (`VITE_*`):

| Var | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend base URL |
| `VITE_GATEWAY_BASE_URL` | Delivery gateway base URL (Nginx front) |
| `VITE_SIA_EXPLORER_URL` | Siascan base (defaults to `https://zen.siascan.com`) |
| `VITE_API_KEY` | Optional dev seed key |

---

## 15. Technical decision log

The choices below are the non-obvious ones; anything not listed follows
conventional Node/React/Postgres patterns.

**Single-file HLS (`-hls_flags single_file`) over classic
per-segment output.**
Every variant becomes one `data.m4s` + a playlist of `EXT-X-BYTERANGE`
references. That reduces the per-video Sia operation budget from O(100+)
to exactly `N + 2` ops for an N-rendition ladder. It also aligns with
Sia's native byte-range download path: a player's segment request
translates to a single Sia range read.

**Two Sia SDKs instead of one.**
`sia-storage` is the control-plane SDK the indexer understands for pin
signing, while `@siafoundation/sia` exposes a Buffer-direct upload API
(`uploadPacked.add(buffer)`) and a callback-free download call. Both
are official Sia Foundation SDKs; SiaStream uses each where it performs
best and bridges handles via the SDKs' own `seal / open` round-trip.

**Pack small files, stream large files.**
Variant playlists (few KB each) and thumbnails (tens of KB) go through
`uploadAndPinPacked` so they share slabs; variant data files go through
`uploadAndPin` one per call so each naturally fills its own slab. This
minimises host-stream contention without giving up throughput.

**Range-passthrough instead of full-file buffering.**
The gateway treats any `Range` request as a pass-through: it fetches
**only** the requested bytes from Sia and returns 206. No partial
bytes are cached — each segment range is effectively unique, and Sia's
slab fetch already reads only the overlapping slabs. Full-GET requests
(manifests, thumbnails) still go through the in-memory LRU because
those objects are tiny and re-requested constantly.

**Nginx microcache in front of the aggregator.**
Nginx microcaches `/v1/objects/*` for a handful of seconds so that a
scrub in a player doesn't hit the Node process for the exact same
range twice. The microcache bounds pressure on both the Node event loop
and the Sia indexer.

**BullMQ over an ad-hoc queue.**
Three named queues (`transcode`, `upload-segments`, `finalize`)
decouple CPU-bound work (FFmpeg) from network-bound work (Sia uploads)
so each can be concurrency-bounded independently. BullMQ also gives us
durable retries with exponential backoff, attempt counters, and
reliable death-letter semantics.

**Drizzle ORM over hand-rolled SQL.**
Schema-first, type-safe, emits plain SQL migrations, and has no runtime
beyond the `postgres` driver — a good fit for a code-first project that
wants migrations checked into the repo.

**Postgres, not a KV.**
Assets need relational integrity (FK from `processing_jobs` to
`video_assets` and `upload_sessions`), range + ordering queries, and a
jsonb field for the processing log. Postgres is the path of least
resistance.

**`tus-js-client` on the client, `@tus/server` on the backend.**
The TUS protocol is specifically what resumable browser-side uploads
need — this is the de-facto implementation on both sides and both
packages are maintained by the TUS authors.

**TanStack Query for all reads.**
Cache invalidation, background refresh, optimistic mutations — doing
all of these by hand with `useEffect` would bloat the Studio
significantly. React Query is the standard.

**Tailwind v4 palette remap, not a custom CSS system.**
Tailwind v4's `@theme` layer lets us point every `teal-*` utility at
the Sia orange palette in one place. Components keep their `teal-*`
class names — zero per-component theming changes.

**Single Node process hosts API + workers.**
For the MVP, the 3 queue workers run inside the same Node process as
the Express app. It simplifies Docker Compose and matches the MVP's
scale target (single-box, single operator). Splitting the worker out
is a trivial change to the Compose file when scale warrants it.

---

## 16. Tests

```
backend/src/__tests__/
  api-key.test.ts, cache-manager.test.ts, chunk-verifier.test.ts,
  dispatcher.test.ts, env.test.ts, ffmpeg-runner.test.ts,
  manifest-rewriter.test.ts, rate-limiter.test.ts,
  routes-assets.test.ts, routes-playback.test.ts,
  routes-uploads.test.ts, routes-webhooks.test.ts,
  session-manager.test.ts, signature.test.ts,
  thumbnail-extractor.test.ts
```

186 backend unit/integration tests run under Vitest and exercise:

* Route handlers with supertest against a Drizzle-backed in-memory stub.
* Webhook HMAC signing + dispatcher retry behaviour.
* FFmpeg argument construction (spawn mocked).
* Manifest rewriting (master + variant), including byte-range
  preservation.
* API-key hashing, scope enforcement, and rate limiting.
* Env schema validation.

The SDK (`packages/sdk`) and React package (`packages/react`) have their
own Vitest suites covering client construction, error mapping, HLS.js
wiring, and the `useVideo` hook.

---

## 17. Deployment

The repo ships three compose files:

* **`docker-compose.yml`** — local dev stack: backend, postgres, redis,
  nginx.
* **`docker-compose.sia.yml`** — optional local Sia testnet: `indexd`,
  `walletd`, `cpuminer`. Useful when you want to run entirely offline;
  can be skipped if pointing at the public Zen indexer.
* **`docker-compose.prod.yml`** — production overrides: named volumes
  for uploads/transcode/cache, pinned image tags, restart policies,
  Nginx TLS config.

Quick start:

```bash
cp .env.example .env
docker compose up -d
cd backend && npm run sia:onboard   # one-time, paste output into .env
docker compose restart backend
```

Nginx serves the frontend static build as the site root and
reverse-proxies `/api/*`, `/v1/*`, and the TUS endpoint to the backend
container.

---

## 18. What runs end-to-end (happy path)

For one `file_example_MP4_1920_18MG.mp4` on Zen testnet, the real
observed pipeline produces:

* 4 rendition data files (1920×1080 / 1280×720 / 960×540 / 640×360)
* 4 variant playlists with `EXT-X-BYTERANGE` references
* 3 thumbnails at 25/50/75%
* 1 master manifest
* 12 pinned Sia objects, 6 of which come from the single packed upload
* 10 slabs observed, 120 sectors (≈ 480 MiB on disk across ~13 hosts)
* Reed–Solomon: 3 data + 9 parity = 4.00× redundancy (read off slab
  metadata, not configured client-side)
* First-frame playback under a couple of seconds via range-passthrough

That is the concrete MVP: upload via TUS, transcode via FFmpeg, pin the
output on Sia through the two Sia Foundation SDKs, serve playback from
Sia through a caching byte-range gateway, expose the whole thing as a
REST API, TypeScript SDK, React player, and operator Studio.

# SiaStream

**Decentralized video streaming on Sia.**

SiaStream takes a source video, transcodes it into adaptive HLS, stores every
segment on the [Sia network](https://sia.tech) via the `sia-storage` SDK, and
serves playback through a byte-range aware HTTP gateway with an on-disk cache
in front.

## What's in the box

- **Resumable uploads** via the TUS protocol.
- **Adaptive HLS transcode** — FFmpeg produces 1080p/720p/540p/360p fMP4
  renditions with CMAF-style init segments and ~6s media segments.
- **Sia-backed object store** — every segment, init fragment, and playlist is
  an individual object on Sia, addressed by its storage key.
- **Delivery gateway** — an aggregator route fetches objects from Sia, caches
  them locally, and streams byte-range responses suitable for `<video>` and
  hls.js playback.
- **API + SDK** — a REST backend plus first-party TypeScript (`@siastream/sdk`)
  and React (`@siastream/react`) packages.

## Quick start

Requirements: Node.js 20+, Docker + Docker Compose, FFmpeg 5+ (only needed
when running the backend outside Docker).

```bash
git clone https://github.com/justmert/sia-stream.git
cd sia-stream
cp .env.example .env
docker compose up -d
```

This starts the backend, PostgreSQL, Redis, and an Nginx caching proxy. The
backend is exposed on `http://localhost:4500`; the proxy on
`http://localhost:80`.

### Sia onboarding

Before the first upload, the backend needs a Sia `APP_ID` / `APP_KEY` pair.
The repo ships a helper script that walks the registration flow against a Sia
indexer:

```bash
# Optional: run a local indexer + walletd + miner stack for Zen testnet
docker compose -f docker-compose.sia.yml up -d

# One-time onboarding against whichever indexer SIA_INDEXER_URL points at
cd backend && npm run sia:onboard
```

The script prints an `SIA_APP_ID` and `SIA_APP_KEY` — paste them into `.env`
and restart the backend.

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

### Using the SDK

```ts
import { SiaStreamClient } from "@siastream/sdk";

const client = new SiaStreamClient({
  apiKey: "wss_your_api_key",
  baseUrl: "http://localhost:4500",
});

const { videoAssetId, uploadUrl } = await client.uploads.create({
  title: "My Video",
  accessTier: "public",
});

await client.uploads.uploadFile(uploadUrl, file, {
  onProgress: (pct) => console.log(`${pct}%`),
});

const asset = await client.assets.waitForReady(videoAssetId);
```

```tsx
import { SiaStreamPlayer } from "@siastream/react";

<SiaStreamPlayer
  src={`http://localhost/v1/stream/${videoAssetId}/master.m3u8`}
  controls
/>
```

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

Playback path: the aggregator resolves a video asset's manifest and segment
references from Postgres, pulls the bytes from Sia on demand (streaming byte
ranges through), and caches them on local disk so repeat plays stay hot.

## Project layout

```
backend/       Node.js backend (Express + BullMQ + Drizzle + sia-storage SDK)
frontend/      Vite + React studio app
packages/sdk/  @siastream/sdk       — TypeScript API client
packages/react/@siastream/react     — SiaStreamPlayer + hooks
nginx/         Aggregator/gateway config
docker-compose.yml      App stack (backend, postgres, redis, nginx)
docker-compose.sia.yml  Optional local Sia indexer / walletd / miner stack
docker-compose.prod.yml Production overrides
```

## Tests

```bash
npm test --workspace=backend
npm test --workspace=@siastream/sdk
npm test --workspace=@siastream/react
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

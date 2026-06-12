# SiaStream

**Decentralized video infrastructure built on Sia.**

Upload, transcode, store, and deliver video content with decentralized storage.

## Overview

SiaStream handles the full video pipeline using Sia for decentralized storage:

- **Upload** -- Resumable uploads via TUS protocol
- **Transcode** -- HLS adaptive bitrate (1080p, 720p, 540p, 360p) with fMP4/CMAF segments
- **Store** -- Each segment stored as an individual Sia object
- **Deliver** -- Caching proxy for low-latency playback

## Quick Start

```bash
git clone https://github.com/justmert/sia-stream.git
cd sia-stream
cp .env.example .env
docker compose up -d
```

```typescript
import { SiaStreamClient } from "@siastream/sdk";

const client = new SiaStreamClient({
  apiKey: "wss_your_api_key",
  baseUrl: "http://localhost:4500",
});

const { videoAssetId, uploadUrl } = await client.uploads.create({
  title: "My Video",
  accessTier: "public",
});

await client.uploads.uploadFile(uploadUrl, videoFile, {
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

See the full [Quickstart Guide](./docs/quickstart.md) for a complete walkthrough.

## Architecture

```
Upload -> TUS Server -> FFmpeg Transcode -> Sia Object Storage
                                                    |
Playback <- Cache <- Aggregator <- Sia Storage Nodes
```

## Project Structure

```
backend/src/                Node.js backend (Express, BullMQ, Drizzle)
packages/sdk/               @siastream/sdk (TypeScript)
packages/react/             @siastream/react (player + hooks)
frontend/                   Frontend app (Vite + React)
docker-compose.yml          Service orchestration
```

## Development

```bash
# Prerequisites: Node.js 20+, Docker, FFmpeg 5+

# Start infrastructure
docker compose up -d

# Backend dev (hot reload)
cd backend && npm install && npm run dev

# Frontend dev
cd frontend && npm install && npm run dev

# Tests
cd backend && npm test
cd packages/sdk && npm test
cd packages/react && npm test
```

## Documentation

| Document | Description |
|---|---|
| [Quickstart](./docs/quickstart.md) | Upload and play a video in 30 minutes |
| [Architecture](./docs/architecture.md) | System design, components, and data flows |
| [API Reference](./docs/api-reference.md) | REST API endpoints with curl examples |
| [Integration Guide](./docs/integration-guide.md) | SDK, React player, webhooks |
| [Deployment Guide](./docs/deployment.md) | Docker setup, env vars, production config |
| [OpenAPI Spec](./docs/openapi.yaml) | Machine-readable API specification |
| [Video Workflows](./docs/video-workflows-spec.md) | Upload, processing, and playback flows |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 -- see [LICENSE](./LICENSE).

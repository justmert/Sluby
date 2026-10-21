# Sluby

Self-hosted video hosting that stores its media on the [Sia](https://sia.tech) network.

Upload a video, and Sluby transcodes it into adaptive HLS, stores it on Sia, and plays it back through your server or straight from Sia in the browser. You manage everything in the Studio web app, or build on the REST API, `@sluby/sdk` and `@sluby/player`.

## Features

- Resumable uploads over tus, from the Studio, the SDK or any tus client.
- Adaptive HLS from 360p up to 1080p, with 1440p and 2160p when you turn them on.
- Storage on Sia through the official `@siafoundation/sia-storage` SDK, with a per-video breakdown of where each object lives.
- Playback through the server's gateway, directly from Sia in the browser, or a mix of both.
- A watch page for every video, to share as a link or embed with an iframe.
- Public and private videos, with signed links that expire and can be revoked.
- A team workspace with admins and members, email and password or GitHub sign-in, and invite links.
- A REST API with scoped API keys, webhooks and an OpenAPI document.

## Quick start

You need Docker with the Compose plugin and an account on [sia.storage](https://sia.storage).

```bash
git clone https://github.com/justmert/Sluby.git
cd Sluby
cp .env.example .env
docker compose build

# prints a url to approve in sia.storage, then three lines to put in .env
docker compose run --rm --no-deps backend node scripts/connect-indexer.mjs

docker compose up -d
docker compose logs backend | grep "setup code"
```

Open `http://localhost:8080` and create the first admin with the setup code. The [install guide](./docs/content/docs/self-hosting/index.mdx) explains each step, and [Run in production](./docs/content/docs/self-hosting/production.mdx) adds a domain and TLS.

## Documentation

The docs are in [`docs/`](./docs/content/docs), split by what you are doing:

| Section                                                    | For                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Studio](./docs/content/docs/studio/index.mdx)             | uploading, sharing and managing videos in the Studio                            |
| [Self-hosting](./docs/content/docs/self-hosting/index.mdx) | installing, configuring and running a Sluby server                              |
| [Developers](./docs/content/docs/developers/index.mdx)     | the API, SDK, player and webhooks, how Sluby works, and the skill for AI agents |

To run the docs site locally:

```bash
npm ci --prefix docs
npm run docs:dev
```

## Packages

| Package                              | What it is                                                      |
| ------------------------------------ | --------------------------------------------------------------- |
| [`@sluby/sdk`](./packages/sdk)       | TypeScript client for the REST API, uploads and webhooks        |
| [`@sluby/player`](./packages/player) | React player, with hls.js loaders for playing straight from Sia |

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) covers the repository layout, running Sluby from source, the tests and the release process.

## License

Apache License 2.0. See [LICENSE](./LICENSE).

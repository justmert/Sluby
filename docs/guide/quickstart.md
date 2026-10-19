# Quickstart

This runs the whole platform on your machine with Docker Compose and takes you to a video playing back from Sia. It uses the hosted [sia.storage](https://sia.storage) indexer, which has a free 50 GB tier, so you don't need to run any Sia infrastructure yourself.

## What you need

- Docker with Compose v2 (Docker Desktop, or Docker Engine with the compose plugin)
- git
- a short video file (any format FFmpeg reads: mp4, mov, mkv, webm)
- a free [sia.storage](https://sia.storage) account

## 1. Clone and configure

```sh
git clone https://github.com/justmert/Sluby.git
cd Sluby
cp .env.example .env
```

The defaults in `.env.example` are set up for this guide: the hosted mainnet indexer, the Studio on `http://localhost:8080`, and sign-in turned off because the stack only listens on localhost.

## 2. Connect to the indexer

Sluby stores data through an app identity registered with your indexer account. Register one:

```sh
docker compose run --rm --no-deps backend node scripts/connect-indexer.mjs
```

The first run builds the backend image, which takes a few minutes (see [build times](#build-times) below); `docker compose up` in step 3 builds the `web` image. The script then prints a URL:

```
1. Open this URL while signed in to your indexer account and approve it:

   https://sia.storage/...

2. Waiting for approval...
```

Open it, sign in to sia.storage and approve the connection. The script finishes with three lines:

```
SIA_INDEXER_URL=https://sia.storage
SIA_APP_ID=...
SIA_APP_KEY=...
```

Put `SIA_APP_ID` and `SIA_APP_KEY` into `.env`. The app key can read and delete everything the app stores, so keep it secret.

## 3. Start the stack

```sh
docker compose up -d
```

This starts PostgreSQL, Redis, the backend and the web front door (nginx serving the Studio and proxying the API and video delivery). `docker compose ps` shows every service as `healthy` once it is up.

## 4. Upload and play

1. Open [http://localhost:8080](http://localhost:8080). The dashboard shows the indexer as **Operational** and how many Sia hosts are accepting uploads.
2. Go to **Upload**, pick your video, give it a title and press **Start upload**.
3. The page follows the pipeline: the upload itself, transcoding, storing on Sia, and finalizing. When it reaches **Ready**, press **Open asset**.
4. The asset page plays the video. Its storage panel lists every Sia object behind it, with slab, sector and host counts.

### How long it takes

Transcoding a short clip takes seconds. Storing it on Sia takes longer, and the time depends on your upload bandwidth rather than on the size of the video.

Sia erasure-codes data into slabs, and each slab goes to 30 hosts as 30 sectors of 4 MiB. That is about 120 MiB on the wire however little data the slab holds. Sluby packs everything it can into as few uploads as possible, but the manifests point at the object ids of what they reference, so one asset always needs three dependent uploads: the media and thumbnails, then the variant playlists, then the master playlist.

On a 37 Mbps uplink, a 10 second clip took between 2.5 and 4 minutes from pressing **Start upload** to **Ready**, depending on how quickly the slowest hosts accepted their sectors. A faster uplink shortens it.

### How long the whole quickstart takes

There is no guaranteed time. Our last measured run from a clean clone, on Apple Silicon with the backend's FFmpeg layer cached from an earlier build and an app identity already registered, spent about five and a half minutes on the steps below:

| Step                                                                 | Time                    |
| -------------------------------------------------------------------- | ----------------------- |
| Building both images (128 seconds of it compiling the ARM64 Sia SDK) | a little over 2 minutes |
| `docker compose up -d --wait`                                        | 25 seconds              |
| Uploading a 10 second 720p clip until it was **Ready**               | 173 seconds             |
| First playback (the manifest and the first segment loaded)           | 2 seconds               |

That machine was heavily loaded by other work during the run (a one-minute load average between 150 and 1000), so an idle machine should be faster, but we have not timed one in this release. An earlier run on an Apple M3 Pro with the base images already pulled took a little over 4 minutes end to end. Creating the sia.storage account, approving the app and editing `.env` come on top. What changes the time most:

- your upload bandwidth and how fast the slowest Sia hosts accept sectors, which dominate the upload step
- whether the base images are already pulled: on ARM64 the first build also downloads the Rust toolchain image (2.2 GB unpacked)
- CPU, for the ARM64 SDK compile and for transcoding longer or larger sources

## 5. Use the API

The Studio is a client of the same REST API your applications use. Create a key under **Settings → API keys**, then:

```sh
export SLUBY_API_KEY=sluby_...

# list assets
curl -H "Authorization: Bearer $SLUBY_API_KEY" http://localhost:8080/api/v1/assets

# playback info for one asset, including the HLS url
curl -H "Authorization: Bearer $SLUBY_API_KEY" http://localhost:8080/api/v1/playback/<asset id>
```

Your server renders an interactive API reference at [http://localhost:8080/api/v1/docs](http://localhost:8080/api/v1/docs), where you can send requests with your key. The [API overview](/api/) covers keys and scopes, pagination, errors and rate limits.

## Build times

The quickstart builds two images, the backend on the first `docker compose run` and the Studio on `docker compose up`:

- `sluby-web` builds the Studio and puts it behind nginx.
- `sluby-backend` installs FFmpeg and the backend's dependencies.

On ARM64 (Apple Silicon, Graviton) the backend build also compiles the Sia SDK's native module from source, because the published ARM64 Linux build of `@siafoundation/sia-storage` 0.1.3 (like 0.1.1 and 0.1.2 before it) cannot make HTTPS requests. On x86-64 the published build is used and nothing is compiled.

For reference, on an Apple M3 Pro with the base images already pulled, the backend image built from scratch in 71 seconds, 54 of them compiling the SDK. A first build also downloads the base images, which on ARM64 include the Rust toolchain image (2.2 GB unpacked). Later builds reuse the cached layers.

## Troubleshooting

**The dashboard says the indexer is degraded or not ready.** A brand new indexer account forms storage contracts before it accepts uploads. Give it a few minutes; the dashboard updates on its own. `docker compose logs backend` shows the connection attempts.

**Port 8080 is taken.** Set `WEB_PORT` in `.env` and also set `PUBLIC_URL` to match, for example `WEB_PORT=8081` and `PUBLIC_URL=http://localhost:8081`, then run `docker compose up -d` again.

**An upload fails while storing on Sia.** The backend retries the media upload a few times before it marks the job failed. The processing log on the upload page and `docker compose logs backend` show the indexer's error.

**Starting over.** `docker compose down -v` removes the containers and every named volume (database, queue, uploads, caches). Objects already pinned on Sia stay in your indexer account; delete assets in the Studio first if you want them unpinned.

## Next steps

- [Production deployment](./production): TLS, sign-in with the first admin and invites, and connecting to an indexer on mainnet or the Zen testnet.
- [Configuration](./configuration): every environment variable the stack reads.

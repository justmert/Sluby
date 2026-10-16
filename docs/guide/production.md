# Production deployment

The production setup is the same Compose stack as the [quickstart](./quickstart) with an override file on top. The override:

- adds [Caddy](https://caddyserver.com) in front of everything. It gets a TLS certificate for your domain from Let's Encrypt and renews it on its own.
- publishes only ports 80 and 443. PostgreSQL, Redis and the web container are reachable only inside the Compose network.
- runs the backend with `NODE_ENV=production`, which refuses to start with a weak `SESSION_SECRET` or with `AUTH_DISABLED=true`.
- requires a PostgreSQL password, a session secret, GitHub sign-in and the Sia app identity, and stops with a message naming whichever one is missing.

```mermaid
flowchart LR
  browser([Browser]) -- "https :443" --> caddy[Caddy<br/>TLS]
  caddy -- "http" --> web[web<br/>Studio + cache]
  web -- "/api /v1 /health" --> backend[backend<br/>API + workers]
  backend --> postgres[(PostgreSQL)]
  backend --> redis[(Redis)]
  backend -- "SDK" --> indexer[Sia indexer]
  backend -- "shards" --> hosts[(Sia hosts)]
```

## Requirements

- a Linux server with Docker Engine and the Compose plugin. The override uses the `!reset` tag, which needs a current Compose v2 release; `docker compose version` shows yours.
- a domain name with an A (and optionally AAAA) record pointing at the server
- ports 80 and 443 reachable from the internet. Caddy needs port 80 for the ACME HTTP challenge and to redirect HTTP to HTTPS.
- disk for uploads in flight, transcoder output and the delivery caches. Finished videos live on Sia, not on this disk.

## 1. Configure

```sh
git clone https://github.com/justmert/Sluby.git
cd Sluby
cp .env.example .env
```

Edit `.env`:

```sh
DOMAIN=video.example.com
ACME_EMAIL=you@example.com          # let's encrypt expiry notices
POSTGRES_PASSWORD=...               # openssl rand -base64 24
SESSION_SECRET=...                  # openssl rand -base64 32
AUTH_DISABLED=false
```

`AUTH_DISABLED` is forced off by the override anyway; setting it here keeps `.env` honest.

## 2. GitHub sign-in

The Studio signs people in with GitHub. Create an OAuth app at [github.com/settings/developers](https://github.com/settings/developers):

- **Homepage URL**: `https://video.example.com`
- **Authorization callback URL**: `https://video.example.com/api/v1/auth/github/callback`

Then add to `.env`:

```sh
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_ALLOWED_USERS=your-login,a-colleague
```

`GITHUB_ALLOWED_USERS` says who may sign in: GitHub logins, `id:<numeric GitHub id>` entries, or `*` for anyone. Each person gets their own account, keyed on their numeric GitHub id rather than the login, so a renamed or re-registered login never moves data between people. A login entry is matched when someone signs in and then pinned to that account: it keeps admitting them after a rename and refuses whoever registers the freed login next. To move an entry to another account, write it as `id:<number>` (`https://api.github.com/users/<login>` shows the id). Removing an entry signs that person out and stops their API keys on their next request; adding it back restores the keys. `*` opens sign-up to every GitHub account, and so does an empty value, which the backend warns about at startup. An open Studio lets anyone store and transcode video on your Sia account with no quota, so put limits in front of it before opening it. See [the allowlist](/architecture/auth-and-tenancy#the-allowlist).

The Studio needs https outside localhost: the session cookie is only marked `Secure` when `PUBLIC_URL` starts with `https://`, and the backend logs a warning when `PUBLIC_URL` is plain http on any other host.

Upgrading from a version that keyed accounts on GitHub logins signs everyone out once. Each person's first sign-in after the upgrade links their old assets, keys and webhooks to their account (see [upgrading](/architecture/auth-and-tenancy#upgrading-from-login-keyed-versions)); their API keys keep working in the meantime.

## 3. Connect to a Sia indexer

The backend stores data through an app identity registered with an indexer. Pick one of the options below, then run the connect script with the indexer's URL:

```sh
docker compose run --rm --no-deps -e SIA_INDEXER_URL=https://sia.storage \
  backend node scripts/connect-indexer.mjs
```

It prints an approval URL. Open it while signed in to the indexer account, approve, and copy the printed `SIA_INDEXER_URL`, `SIA_APP_ID` and `SIA_APP_KEY` into `.env`. Run this once per deployment. Running it again registers a second app with its own, separate storage.

### Mainnet with sia.storage

[sia.storage](https://sia.storage) is a hosted mainnet indexer with a free 50 GB tier, and it is what `.env.example` points at.

```sh
SIA_INDEXER_URL=https://sia.storage
SIA_NETWORK=mainnet
```

Leave `SIA_DATA_SHARDS` and `SIA_PARITY_SHARDS` unset. The SDK then uses its default of 10 data and 20 parity shards per slab, spread over 30 hosts.

### Mainnet with your own indexer

Run [indexd](https://github.com/SiaFoundation/indexd) on mainnet (its README covers the setup; it needs PostgreSQL 18 and a funded wallet to form contracts), approve the connection in its admin UI, and point Sluby at its application API:

```sh
SIA_INDEXER_URL=https://indexer.example.com   # indexd's application api, port 9982 by default
SIA_NETWORK=mainnet
# optional: the admin api adds contract ids and the wallet to the storage view
SIA_ADMIN_URL=http://indexd:9980
SIA_ADMIN_PASSWORD=...
```

The admin API is password protected and should never be exposed publicly. Only set `SIA_ADMIN_URL` when the backend can reach it over a private network.

### Zen testnet

[Zen](https://docs.sia.tech/testnet/zen-testnet) is Sia's testnet, where coins have no value. There is no hosted Zen indexer, so you run indexd yourself. `docker-compose.sia.yml` in the repository runs indexd on Zen, plus walletd and a CPU miner so you can mine the Zen coins indexd needs to form contracts. Its header comments walk through the setup.

Zen's host pool is small: 14 hosts were online in October 2026 ([zen.siascan.com](https://zen.siascan.com)). Two defaults assume a mainnet sized pool and have to change:

**Shards per slab.** The default 10 data + 20 parity shards needs 30 hosts. Set a ratio that fits the pool:

```sh
SIA_NETWORK=zen
SIA_DATA_SHARDS=3
SIA_PARITY_SHARDS=9
```

Both the SDK and indexd validate the ratio before accepting a slab. They require redundancy between 1.5x and 4x, and at least a 99.99% chance of recovering the slab assuming each host independently stays available with probability 0.75. With 14 or fewer hosts, the ratios that pass are 3 data shards over 12 or 13 hosts, and 4 data shards over 14 hosts. Smaller ratios such as 2-of-6 are rejected unless both the SDK and indexd are built with a higher per-host availability assumption. `backend/vendor/README.md` describes building the SDK that way and passing the binary in with the `SIA_STORAGE_NATIVE` build argument.

**Account readiness.** indexd reports an app's account as ready once it has funded 30 host accounts (`ReadyHostThreshold` in indexd's `accounts/manager.go`). A pool smaller than that never gets there, so on Zen the account keeps reporting not ready, and the Studio dashboard shows it that way. Getting a ready account on Zen means building indexd from source with that constant lowered below the number of hosts you have contracts with.

The connect step and everything else work the same as on mainnet.

## 4. Start

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Watch the first start:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy backend
```

Caddy logs the certificate it obtained, the backend logs `Sluby backend is running` and `sia-storage SDK ready`. Open `https://video.example.com`, sign in with GitHub, and the dashboard shows the indexer's status.

To save typing, put the file list in `.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

and plain `docker compose up -d`, `docker compose logs` and so on use both files.

## Behind an existing reverse proxy

If the server already terminates TLS (nginx, Traefik, a cloud load balancer), skip the Caddy override and point your proxy at the `web` container, which the base file publishes on `127.0.0.1:${WEB_PORT}` (8080 by default). Then set in `.env`:

```sh
NODE_ENV=production
PUBLIC_URL=https://video.example.com
AUTH_DISABLED=false
```

along with `SESSION_SECRET`, `POSTGRES_PASSWORD` and the GitHub settings. Your proxy must pass the original `Host` header and set `X-Forwarded-Proto: https`, so that upload and sign-in URLs come out as `https://`. Allow request bodies of at least 8 MiB, the tus chunk size the Studio uploads with; nginx's default `client_max_body_size` of 1 MB is too small.

## Operating it

**Upgrades.** Pull and rebuild; migrations run when the backend starts.

```sh
git pull
docker compose up -d --build
```

**Backups.** The database is the one thing to back up: it maps every asset to its Sia objects. Video data lives on Sia and the app key in `.env` is what grants access to it, so keep a copy of `.env` somewhere safe too.

```sh
docker compose exec postgres pg_dump -U sluby sluby | gzip > sluby-$(date +%F).sql.gz
```

**Health.** `GET /health` is a liveness check. `GET /api/v1/system/status` reports PostgreSQL, Redis, the indexer account and host counts to a platform key (minted by `npm run db:seed-key --workspace=backend`); other callers, the Studio included, get a health summary without the account, error details or caches. The backend serves Prometheus metrics at `GET /metrics` on port 3000. The web proxy does not expose that path, so scrape it from a container on the Compose network. A scrape answers even while Redis is down: the queue depth read is cut off after 2 seconds, `sluby_redis_up` is then 0 and `sluby_processing_queue_depth` is `NaN`. Cache use is exposed as the counters `sluby_cache_hits_total` and `sluby_cache_misses_total` (whole-object reads only; ranged media reads bypass that cache), so take a rate over a window rather than a ratio since start.

**Volumes.** Every piece of state is in a named volume: `pgdata`, `redis-data`, `uploads`, `transcode-output`, `nginx-cache`, and in production `caddy-data` (certificates) and `caddy-config`. `docker compose down` keeps them; `docker compose down -v` deletes them.

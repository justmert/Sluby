# Production deployment

The production setup is the same Compose stack as the [quickstart](./quickstart) with an override file on top. The override:

- adds [Caddy](https://caddyserver.com) in front of everything. It gets a TLS certificate for your domain from Let's Encrypt and renews it on its own, and sends `Strict-Transport-Security` so browsers stay on HTTPS. The other security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and the Studio's `Content-Security-Policy`) come from the web container in every setup.
- sets `CORS_ORIGIN` to `https://$DOMAIN`, so only the Studio's own origin is trusted with the session cookie. Apps on other origins can still call the API with a key.
- publishes only ports 80 and 443. PostgreSQL, Redis and the web container are reachable only inside the Compose network.
- runs the backend with `NODE_ENV=production`, which refuses to start with a missing or weak `SESSION_SECRET`, with `AUTH_DISABLED=true`, or with a `BOOTSTRAP_API_KEY` that is not a generated key.
- requires a PostgreSQL password, a session secret and the Sia app identity, and stops with a message naming whichever one is missing. GitHub sign-in is optional.

```mermaid
flowchart LR
  browser([Browser]) -- "https :443" --> caddy[Caddy<br/>TLS]
  caddy -- "http" --> web[web<br/>Studio + proxy]
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
- memory for the backend: the gateway's object cache (`CACHE_MAX_SIZE_MB`, 256 MB by default) on top of the process itself. Video bytes are streamed from Sia to the viewer and never held whole, so the number of viewers does not grow it.

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

## 2. GitHub sign-in (optional)

Members sign in with an email and password. GitHub is an extra way to sign in, never a way in: only someone who is already a member, or who has an invite, gets in with GitHub. To offer it, create an OAuth app at [github.com/settings/developers](https://github.com/settings/developers):

- **Homepage URL**: `https://video.example.com`
- **Authorization callback URL**: `https://video.example.com/api/v1/auth/github/callback`

Then add to `.env`:

```sh
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

With both set, the sign-in screen and invite pages offer GitHub, and members can add GitHub to their account in Settings. A GitHub account is matched on its numeric id, not the login, so a renamed or re-registered login never reaches someone else's account.

The Studio needs https outside localhost: the session cookie is only marked `Secure` when `PUBLIC_URL` starts with `https://`, and the backend logs a warning when `PUBLIC_URL` is plain http on any other host.

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

[Zen](https://docs.sia.tech/testnet/zen-testnet) is Sia's testnet, where coins have no value. There is no hosted Zen indexer, so you run indexd yourself. `docker-compose.sia.yml` in the repository runs indexd on Zen with PostgreSQL 18, plus walletd and a CPU miner so you can mine the Zen coins indexd needs to form contracts. Its header comments walk through the setup.

This path was not re-verified for this release. The file pins indexd 0.6.0 and walletd 2.15.2, but nobody ran the setup end to end with those versions, so check its steps against the indexd README as you go. The changes in this release were tested live on mainnet with sia.storage.

Zen's host pool is small: 14 hosts were online in October 2026 ([zen.siascan.com](https://zen.siascan.com)). Two defaults assume a mainnet sized pool and have to change:

**Shards per slab.** The default 10 data + 20 parity shards needs 30 hosts. Set a ratio that fits the pool:

```sh
SIA_NETWORK=zen
SIA_DATA_SHARDS=3
SIA_PARITY_SHARDS=9
```

Both the SDK and indexd validate the ratio before accepting a slab. They require redundancy between 1.5x and 4x, and at least a 99.99% chance of recovering the slab assuming each host independently stays available with probability 0.75. With 14 or fewer hosts, the ratios that pass are 3 data shards over 12 hosts (3 + 9) and 4 data shards over 14 hosts (4 + 10). 3 over 13 hosts is 4.33x redundancy, above the 4x limit, so every upload with it is refused. Smaller ratios such as 2-of-6 are rejected unless both the SDK and indexd are built with a higher per-host availability assumption. `backend/vendor/README.md` describes building the SDK that way and passing the binary in with the `SIA_STORAGE_NATIVE` build argument.

**Account readiness.** indexd reports an app's account as ready once it has funded 30 host accounts (`ReadyHostThreshold` in indexd's `accounts/manager.go`). A pool smaller than that never gets there, so on Zen the account keeps reporting not ready, and the Studio dashboard shows it that way. Getting a ready account on Zen means building indexd from source with that constant lowered below the number of hosts you have contracts with.

The connect step and everything else work the same as on mainnet.

## 4. Start

**Coming from the quickstart?** PostgreSQL sets the `sluby` user's password only when it creates its data volume, so a volume made by the quickstart keeps the password `sluby`, and a backend started with a new `POSTGRES_PASSWORD` fails with `password authentication failed` and restarts in a loop. Either start from empty volumes (`docker compose down -v`, which deletes the quickstart's database, uploads and caches; videos already on Sia stay in your indexer account but Sluby forgets them), or keep the data and change the password before you switch, with the quickstart stack still running:

```sh
docker compose exec postgres psql -U sluby -d sluby -c "ALTER USER sluby PASSWORD 'the POSTGRES_PASSWORD from .env'"
```

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Watch the first start:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy backend
```

Caddy logs the certificate it obtained, the backend logs `Sluby backend is running` and `sia-storage SDK ready`. Then set up the first admin (next step), and the dashboard shows the indexer's status.

To save typing, put the file list in `.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

and plain `docker compose up -d`, `docker compose logs` and so on use both files.

## 5. Set up the first admin

A fresh install has no admin, so the backend logs a setup code at startup, until an admin exists:

```sh
docker compose logs backend | grep "setup code"
```

```
No admin can sign in yet. Open https://video.example.com/studio and set up the first admin with the setup code ABCDE-FGHJK.
```

Open the Studio, enter the code with your name, email and a password (10 to 256 characters), and you are signed in as the first admin. The code is derived from `SESSION_SECRET`, so only someone who can read the server's logs or environment can use it, and setup is refused once an admin exists.

Everyone else joins by invite: on the Members page, make an invite link with the role `member` or `admin` and pass it on. A link works once, for 7 days. Members upload, edit and share videos and manage keys and webhooks; admins also see the server's operations views (indexer account, storage, cache, reconciliation, metrics) and manage members. There is no email: when someone forgets their password, an admin makes them a reset link on the Members page. If you are the admin who is locked out, print one from the server:

```sh
docker compose exec backend node dist/db/reset-link.js --email you@example.com
```

See [accounts and roles](/architecture/auth-and-tenancy) for the details.

## Behind an existing reverse proxy

If the server already terminates TLS (nginx, Traefik, a cloud load balancer), skip the Caddy override and point your proxy at the `web` container, which the base file publishes on `127.0.0.1:${WEB_PORT}` (8080 by default). Then set in `.env`:

```sh
NODE_ENV=production
PUBLIC_URL=https://video.example.com
CORS_ORIGIN=https://video.example.com
AUTH_DISABLED=false
```

along with `SESSION_SECRET`, `POSTGRES_PASSWORD`, the Sia app identity and, if you want GitHub sign-in, the GitHub settings. Your proxy must pass the original `Host` header and set `X-Forwarded-Proto: https`, so that upload and sign-in URLs come out as `https://`, and set `X-Forwarded-For` to the client's address: the web container takes the client from it because your proxy reaches it from a private address, and the per-client [limits](./configuration#web-proxy) key on it. Allow request bodies of at least 10 MiB, the tus chunk size `@sluby/sdk` uploads with by default (the Studio uses 8 MiB), and more if your apps raise `chunkSize`; nginx's default `client_max_body_size` of 1 MB is too small. Send `Strict-Transport-Security` from your proxy, where TLS ends; the web container sends the other security headers.

## Operating it

**Upgrades.** Pull and rebuild; migrations run when the backend starts. Replicas starting together take turns on a database lock, so each migration runs once. A migration that adds an index locks its table while it builds, which takes a while on a large table, so plan the upgrade window for a big database.

```sh
git pull
docker compose up -d --build
```

**BullMQ version.** Sluby uses BullMQ 5. Version 0.1.0 stored the reconciliation and deletion sweeps as legacy repeat entries; this release moves them to job schedulers and removes the old entries on its first start. Upgrade an existing 0.1.0 deployment by starting this release once, rather than replacing its Redis data.

**Upgrading to members and roles.** An install from a version without members becomes one team workspace: every video, key and webhook of every account belongs to the workspace, and every member sees all of them. On the first start after the upgrade, `GITHUB_ALLOWED_USERS` removes the GitHub accounts it would have refused and the accounts in `OPERATOR_USERS` become admins, once. After that both settings are ignored and the backend warns while they are set, so remove them from `.env`. Keep `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: existing members go on signing in with GitHub. When neither setting made anyone an admin, the backend logs the setup code; set up an admin as in [step 5](#_5-set-up-the-first-admin) and give the others their roles on the Members page. A key made by an account acts with that member's role; keys of other owners (the bootstrap key, keys from `db:seed-key`, keys of `github:<login>` owners from before accounts existed) act as admins, so review the keys in Settings. See [upgrading](/architecture/auth-and-tenancy#upgrading-an-existing-install).

**Backups.** The database is the one thing to back up: it maps every asset to its Sia objects. Video data lives on Sia and the app key in `.env` is what grants access to it, so keep a copy of `.env` somewhere safe too.

```sh
docker compose exec postgres pg_dump -U sluby sluby | gzip > sluby-$(date +%F).sql.gz
```

**Health.** `GET /health` is a liveness check. `GET /api/v1/system/status` reports PostgreSQL, Redis, the indexer account and host counts to admins (their Studio sessions and keys, the `BOOTSTRAP_API_KEY`, and keys from `docker compose exec backend node dist/db/seed-api-key.js`); members get a health summary without the account, error details or caches. The backend serves Prometheus metrics at `GET /metrics` on port 3000. The web proxy does not expose that path (it answers 404), so scrape it from a container on the Compose network. Set `METRICS_TOKEN` and the endpoint also needs `Authorization: Bearer <token>`, which a Prometheus scrape config sends with `authorization: { credentials: <token> }`; do that whenever port 3000 is reachable from outside the Compose network. A scrape answers even while Redis is down: the queue depth read is cut off after 2 seconds, `sluby_redis_up` is then 0 and `sluby_processing_queue_depth` is `NaN`. Cache use is exposed as the counters `sluby_cache_hits_total` and `sluby_cache_misses_total` (whole-object reads only; ranged media reads bypass that cache), so take a rate over a window rather than a ratio since start.

**Limits.** The web container limits each client address on delivery and sign-in, and the backend limits unauthenticated API calls per address and every key per minute. The defaults are generous; the [configuration reference](./configuration#rate-limits) lists the knobs.

**More than one backend.** Run one backend container. A second replica against the same PostgreSQL and Redis starts and shares the queues, and slab prunes wait for the uploads of every replica, since the prune gate lives in Redis. Some state still stays in each process, see [one backend process](../architecture/#components) for the details:

- making an asset private, deleting it or revoking its signed URLs takes up to 60 seconds to reach the other replicas;
- each replica allows the full API rate limits, so the effective limit is that many times higher;
- uploads and the pipeline stages read files on `UPLOAD_DIR` and `TRANSCODE_OUTPUT_DIR`, so replicas need the same volumes, which Compose only gives replicas on one host;
- `/metrics` and the Studio's storage views describe only the replica that answered.

**Stopping.** On `docker compose stop`, `down` or an upgrade the backend stops taking requests and jobs, finishes what is running for up to 25 seconds, closes its connections and exits with code 0, logging `Graceful shutdown complete`. Compose waits 30 seconds (`stop_grace_period`) before killing it. A transcode or Sia upload still running after 25 seconds is cut off and runs again from the start once the backend is back.

**Logs.** Each container keeps at most five 10 MB log files (Docker's `json-file` driver).

**Volumes.** Every piece of state is in a named volume: `pgdata`, `redis-data`, `uploads`, `transcode-output`, `nginx-cache`, and in production `caddy-data` (certificates) and `caddy-config`. `docker compose down` keeps them; `docker compose down -v` deletes them.

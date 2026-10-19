# Configuration

Docker Compose reads `.env` in the repository root and passes the values below to the containers. When you run the backend from source instead, it reads the same `.env`, and the defaults are the same as in Compose except where a table says otherwise. A value the backend cannot read (a misspelled flag such as `yes`, a number out of range) stops it at start with a message naming the variable. Flags take `true`, `false`, `1` or `0`.

## Sia

| Variable             | Default                 | Description                                                                                                      |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SIA_INDEXER_URL`    | `https://sia.storage`   | The indexer's application API.                                                                                   |
| `SIA_NETWORK`        | `mainnet`               | `mainnet`, `zen`, `testnet` or `anagami`. Used for labels and explorer links in the Studio.                      |
| `SIA_APP_ID`         |                         | The app's 32-byte id in hex, printed by the connect script.                                                      |
| `SIA_APP_KEY`        |                         | The app's secret key in hex, printed by the connect script. It can read and delete everything the app stores.    |
| `SIA_DATA_SHARDS`    |                         | Data shards per slab. Set together with `SIA_PARITY_SHARDS`, or leave both unset for the SDK default of 10 + 20. |
| `SIA_PARITY_SHARDS`  |                         | Parity shards per slab.                                                                                          |
| `SIA_ADMIN_URL`      | `http://127.0.0.1:9980` | A self-hosted indexd's admin API. Adds contract ids and the wallet address to the storage view.                  |
| `SIA_ADMIN_PASSWORD` |                         | Password for `SIA_ADMIN_URL`.                                                                                    |

## Sign-in

Members, roles and invites live in the database and are managed on the Studio's Members page, not here (see [accounts and roles](/architecture/auth-and-tenancy)).

| Variable               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_DISABLED`        | `false` | `true` signs every visitor in as a local admin with full access. Pages on other origins get no CORS and their writes are refused. The backend refuses to start with it in production.                                                                                                                                                                                                                                                                                                                                                             |
| `SESSION_SECRET`       |         | Signs session cookies, a key derived from it signs private playback URLs, and the setup code for the first admin is derived from it. Unset (never in production), the backend generates one on its first start and keeps it in its database (`instance_meta`), so sessions, signed URLs and the setup code survive a restart. Production refuses to start without one of at least 32 characters. Changing it signs everyone out and voids every signed URL; to void only one asset's signed URLs, use `POST /api/v1/playback/{id}/signed/revoke`. |
| `GITHUB_CLIENT_ID`     |         | GitHub OAuth app id. Optional: with it and `GITHUB_CLIENT_SECRET` set, members can sign in with GitHub, invited people can join with it, and members can add it to their account. A GitHub account that is not a member's is refused. Set the app's callback to `<PUBLIC_URL>/api/v1/auth/github/callback`.                                                                                                                                                                                                                                       |
| `GITHUB_CLIENT_SECRET` |         | GitHub OAuth app secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GITHUB_ALLOWED_USERS` |         | Only read once, on the first start after upgrading from a version without members: GitHub accounts it would have refused are removed. Ignored after that, with a warning at every start while it is set, so remove it. See [upgrading](/architecture/auth-and-tenancy#upgrading-an-existing-install).                                                                                                                                                                                                                                             |
| `OPERATOR_USERS`       |         | Only read once, on the first start after upgrading from a version without members: the GitHub accounts it lists (`github:id:<number>`, `github:<login>` or `github:*`) become admins. Ignored after that, with a warning at every start while it is set, so remove it. An entry without a provider still stops the backend from starting. See [upgrading](/architecture/auth-and-tenancy#upgrading-an-existing-install).                                                                                                                          |
| `BOOTSTRAP_API_KEY`    |         | A raw `sluby_...` key seeded with every scope before the backend takes requests; if seeding fails, the backend does not start. It is seeded once: after you delete or rotate it, it never comes back, and the backend logs a warning while the variable still holds it. Set a new value to seed another. Production requires a generated key (`sluby_` and at least 32 more letters, digits, `-` or `_`). It belongs to the workspace and has no creator, so it acts as an admin.                                                                 |

## Webhooks

| Variable                   | Default | Description                                                                                                                                                                                                                                              |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_ALLOWED_NETWORKS` |         | Networks webhook receivers may be on although they are private or otherwise special, as comma-separated CIDRs or addresses, such as `10.0.5.0/24,fd00:5::/64`. Empty: webhooks reach public addresses only. A bad entry stops the backend from starting. |

## Server

| Variable                  | Default                            | Description                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`              | `http://localhost:8080`            | The URL browsers use. Upload and sign-in URLs are built from it. From source the default is `http://localhost:3000`.                                                                                                                                                                                                                                |
| `NODE_ENV`                | `development`                      | `development`, `production` or `test`. `production` turns on the startup safety checks (session secret, `AUTH_DISABLED`, bootstrap key format) and JSON logs. Nothing else depends on it.                                                                                                                                                           |
| `WEB_PORT`                | `8080`                             | Local port for the web container (base Compose file only).                                                                                                                                                                                                                                                                                          |
| `EXPOSE_ERROR_STACKS`     | `false`                            | `true` adds the internal message and stack trace to error responses, for debugging. They carry file paths and internals, so leave it off anywhere reachable by others.                                                                                                                                                                              |
| `LOG_LEVEL`               | `info`                             | Backend log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. The Sia SDK's own messages follow it. Health checks log at `debug`. Logged URLs keep only harmless query values (`sig`, `code`, `state` and any other are redacted).                                                                                             |
| `CORS_ORIGIN`             |                                    | Comma-separated origins (`https://host[:port]`, no path) whose pages may call the API with the Studio session cookie. Any other origin may call it with an API key, never with cookies. While `AUTH_DISABLED` is on, other origins get no CORS at all. The production override sets `https://$DOMAIN`.                                              |
| `TRUST_PROXY`             | `loopback, linklocal, uniquelocal` | Which proxy hops the backend trusts for the client address in `X-Forwarded-For`: a hop count, `true`, or addresses and ranges (Express's `trust proxy`). The default trusts private networks, which is right for the web proxy alone and for Caddy in front of it.                                                                                  |
| `MAX_UPLOAD_SIZE`         | 10 GiB                             | Largest accepted upload, in bytes.                                                                                                                                                                                                                                                                                                                  |
| `CACHE_MAX_SIZE_MB`       | 256                                | Size bound, in megabytes, of the gateway's in-memory cache of whole objects of up to 8 MB (manifests, playlists and thumbnails fetched without a `Range` header). It counts against the backend container's memory, so keep it well below the container's limit. Larger objects are streamed from Sia and never held in memory.                     |
| `TRANSCODE_MAX_RENDITION` | `1080p`                            | Tallest rung of the transcode ladder: `2160p`, `1440p`, `1080p`, `720p`, `540p` or `360p`. `1440p` and `2160p` add rungs for sources that tall (at 9 and 15 Mbps); a 4K source then took about 2.4 times as long to transcode as with the default. Lower values drop rungs. See [the upload pipeline](../architecture/upload-pipeline#transcoding). |
| `METRICS_TOKEN`           |                                    | When set, `GET /metrics` on the backend port needs `Authorization: Bearer <token>`. Unset, it answers anyone who can reach port 3000, which the Compose files keep on the internal network.                                                                                                                                                         |

Browsers on another origin: a page on another origin can never use a signed-in Studio session unless its origin is in `CORS_ORIGIN`, and the API refuses writes (`POST`, `PUT`, `PATCH`, `DELETE`) that a page on another origin sends without an `Authorization` header, since those could only be riding on the cookie or on `AUTH_DISABLED`.

## Rate limits

The backend limits API calls per minute, in its own memory (one backend process, so one set of counters; a restart resets them).

| Variable                   | Default | Description                                                                                                                                                                                    |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_IP_RATE_LIMIT`        | `600`   | Calls per client address per minute that carry no valid key or session: the sign-in routes, the API spec and docs, and failed authentication. Calls that authenticate do not count against it. |
| `API_KEY_RATE_LIMIT_MAX`   | `10000` | The highest `rate_limit` a key can be created with, and the most any key gets, whatever it was created with.                                                                                   |
| `API_KEYS_PER_ACCOUNT_MAX` | `100`   | Usable keys the workspace can hold; creating one more answers `409`.                                                                                                                           |

Each API key carries its own requests-per-minute limit, set with `rate_limit` when the key is created (100 when left out), and Studio sessions get 1000. Over a limit the API answers `429` with `Retry-After`. Everyone behind one address (an office NAT) shares the per-address limit.

## Web proxy

The `web` container (nginx) also limits each client address on the routes anyone can call without a key: delivery (`/v1/`) and sign-in (`/api/v1/auth/`). The client address is taken from `X-Forwarded-For` when the connection comes from a private network (Caddy, or your own proxy in front). Over a limit it answers `429` with `Retry-After: 1`. The defaults are generous on purpose, so a whole office or school behind one address can watch at once; lower them if Sia egress cost matters more than that.

| Variable             | Default  | Description                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `WEB_DELIVERY_RATE`  | `100r/s` | Delivery requests per client address, per second (`r/s`) or minute (`r/m`).      |
| `WEB_DELIVERY_BURST` | `400`    | Requests above that rate answered at once before the limit starts refusing them. |
| `WEB_DELIVERY_CONN`  | `200`    | Delivery requests one client address can have in flight at the same time.        |
| `WEB_AUTH_RATE`      | `10r/s`  | Sign-in requests per client address.                                             |
| `WEB_AUTH_BURST`     | `50`     | Sign-in requests above that rate answered at once.                               |
| `WEB_AUTH_CONN`      | `20`     | Sign-in requests one client address can have in flight.                          |

A value that is not a rate or a whole number stops the `web` container at start with a message naming it.

## Background work

| Variable                      | Default    | Description                                                                            |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `RECONCILE_ENABLED`           | `true`     | Periodically compare the database with the indexer's pinned objects and flag drift.    |
| `RECONCILE_INTERVAL_MS`       | 1 hour     | How often reconciliation runs.                                                         |
| `DELETION_GC_ENABLED`         | `true`     | Re-drive deletions that stopped half way, for example after a crash.                   |
| `DELETION_GC_INTERVAL_MS`     | 15 minutes | How often that sweep runs.                                                             |
| `RECONCILE_PAGE_SIZE`         | `500`      | Objects read per page of the indexer's change feed, at most 500 (the indexer's limit). |
| `DELETION_STUCK_THRESHOLD_MS` | 10 minutes | How long an asset may sit half deleted before that sweep picks it up again.            |

The schedules live in Redis and are brought in line with these settings at every backend start: a changed interval replaces the schedule, and `false` removes it.

## Running from source

Compose sets these inside the containers; from source the backend uses the defaults below unless `.env` or the shell sets them. `docker-compose.dev.yml` publishes the Compose PostgreSQL on port 5433 and Redis on 6380 for this, see `CONTRIBUTING.md`.

| Variable                  | Default                                         | Description                                                                      |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`            | `postgresql://sluby:sluby@localhost:5432/sluby` | PostgreSQL connection string, also used by `db:migrate` and `db:seed-key`.       |
| `REDIS_URL`               | `redis://localhost:6379`                        | Redis for the queues.                                                            |
| `PORT`                    | `3000`                                          | Port the backend listens on.                                                     |
| `HOST`                    | `0.0.0.0`                                       | Address the backend listens on.                                                  |
| `UPLOAD_DIR`              | `./uploads`                                     | Where tus uploads are written.                                                   |
| `TRANSCODE_OUTPUT_DIR`    | `./transcode-output`                            | Where transcoder output waits for the Sia upload.                                |
| `STUDIO_API_PROXY_TARGET` | `http://localhost:3000`                         | Where the Studio's dev server (`npm run dev:frontend`) proxies `/api` and `/v1`. |

## Production override

Read by `docker-compose.prod.yml` only.

| Variable            | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `DOMAIN`            | The domain Caddy gets a certificate for. `PUBLIC_URL` becomes `https://$DOMAIN`. |
| `ACME_EMAIL`        | Contact address for Let's Encrypt.                                               |
| `POSTGRES_PASSWORD` | Password for the `sluby` database user.                                          |

The override also requires `SESSION_SECRET` and the Sia app identity, and stops with a message naming whichever one is missing. GitHub sign-in stays optional in production.

## Studio build

The Studio is a static build, so these are fixed when the `web` image is built. Change them, then `docker compose build web`.

| Variable                     | Description                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_SLUBY_SIA_INDEXER_URL` | Indexer for direct-from-Sia playback in the Studio player.                                     |
| `VITE_SLUBY_SIA_APP_ID`      | A viewer app id from `scripts/provision-viewer.mjs`.                                           |
| `VITE_SLUBY_SIA_APP_KEY`     | The viewer app's key. It ships to browsers, so use a separate viewer app, never the backend's. |
| `VITE_SIA_EXPLORER_URL`      | Explorer for host and contract links. Defaults to Siascan for the network the backend reports. |

## Image build

| Variable             | Description                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SIA_STORAGE_NATIVE` | Path under `backend/vendor/` of a custom-built SDK native module to use instead of the published one. See `backend/vendor/README.md`. |

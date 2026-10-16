# Configuration

Docker Compose reads `.env` in the repository root and passes the values below to the containers. When you run the backend from source instead, it reads the same `.env`.

## Sia

| Variable             | Default               | Description                                                                                                      |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SIA_INDEXER_URL`    | `https://sia.storage` | The indexer's application API.                                                                                   |
| `SIA_NETWORK`        | `mainnet`             | `mainnet` or `zen`. Used for labels and explorer links in the Studio.                                            |
| `SIA_APP_ID`         |                       | The app's 32-byte id in hex, printed by the connect script.                                                      |
| `SIA_APP_KEY`        |                       | The app's secret key in hex, printed by the connect script. It can read and delete everything the app stores.    |
| `SIA_DATA_SHARDS`    |                       | Data shards per slab. Set together with `SIA_PARITY_SHARDS`, or leave both unset for the SDK default of 10 + 20. |
| `SIA_PARITY_SHARDS`  |                       | Parity shards per slab.                                                                                          |
| `SIA_ADMIN_URL`      |                       | A self-hosted indexd's admin API. Adds contract ids and the wallet address to the storage view.                  |
| `SIA_ADMIN_PASSWORD` |                       | Password for `SIA_ADMIN_URL`.                                                                                    |

## Sign-in

| Variable               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_DISABLED`        | `false` | `true` signs every visitor in as a local user with full access. Pages on other origins get no CORS and their writes are refused. The backend refuses to start with it in production.                                                                                                                                                                                                                                                                                     |
| `SESSION_SECRET`       |         | Signs session cookies. At least 32 characters in production.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GITHUB_CLIENT_ID`     |         | GitHub OAuth app id.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GITHUB_CLIENT_SECRET` |         | GitHub OAuth app secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GITHUB_ALLOWED_USERS` |         | Who may sign in, comma-separated: GitHub logins, `id:<numeric GitHub id>`, or `*` for anyone. A login is pinned to the account that first signs in with it, so it keeps admitting that account after a rename and never admits the next owner of the name. Taking an entry out stops that person's sessions and API keys on their next request. Empty also lets anyone in, with a warning at startup. See [the allowlist](/architecture/auth-and-tenancy#the-allowlist). |
| `BOOTSTRAP_API_KEY`    |         | A raw `sluby_...` key seeded with every scope at startup whenever that key is not already in the database. Deleting it brings it back on the next start; rotating it retires it for good. It belongs to its own `platform` account, so it does not see assets uploaded in the Studio.                                                                                                                                                                                    |

## Webhooks

| Variable                   | Default | Description                                                                                                                                                                                                                                              |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_ALLOWED_NETWORKS` |         | Networks webhook receivers may be on although they are private or otherwise special, as comma-separated CIDRs or addresses, such as `10.0.5.0/24,fd00:5::/64`. Empty: webhooks reach public addresses only. A bad entry stops the backend from starting. |

## Server

| Variable                  | Default                            | Description                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`              | `http://localhost:8080`            | The URL browsers use. Upload and sign-in URLs are built from it.                                                                                                                                                                                                                                                                                    |
| `NODE_ENV`                | `development`                      | `production` turns on the startup safety checks and JSON logs.                                                                                                                                                                                                                                                                                      |
| `WEB_PORT`                | `8080`                             | Local port for the web container (base Compose file only).                                                                                                                                                                                                                                                                                          |
| `LOG_LEVEL`               | `info`                             | Backend log level: `trace`, `debug`, `info`, `warn`, `error`.                                                                                                                                                                                                                                                                                       |
| `CORS_ORIGIN`             |                                    | Comma-separated origins (`https://host[:port]`, no path) whose pages may call the API with the Studio session cookie. Any other origin may call it with an API key, never with cookies. While `AUTH_DISABLED` is on, other origins get no CORS at all. The production override sets `https://$DOMAIN`.                                              |
| `TRUST_PROXY`             | `loopback, linklocal, uniquelocal` | Which proxy hops the backend trusts for the client address in `X-Forwarded-For`: a hop count, `true`, or addresses and ranges (Express's `trust proxy`). The default trusts private networks, which is right for the web proxy alone and for Caddy in front of it.                                                                                  |
| `MAX_UPLOAD_SIZE`         | 10 GiB                             | Largest accepted upload, in bytes.                                                                                                                                                                                                                                                                                                                  |
| `CACHE_MAX_SIZE_MB`       | 10 GiB                             | Size bound, in megabytes, of the gateway's in-memory cache of whole objects (manifests and thumbnails fetched without a `Range` header). It counts against the backend container's memory.                                                                                                                                                          |
| `TRANSCODE_MAX_RENDITION` | `1080p`                            | Tallest rung of the transcode ladder: `2160p`, `1440p`, `1080p`, `720p`, `540p` or `360p`. `1440p` and `2160p` add rungs for sources that tall (at 9 and 15 Mbps); a 4K source then took about 2.4 times as long to transcode as with the default. Lower values drop rungs. See [the upload pipeline](../architecture/upload-pipeline#transcoding). |
| `METRICS_TOKEN`           |                                    | When set, `GET /metrics` on the backend port needs `Authorization: Bearer <token>`. Unset, it answers anyone who can reach port 3000, which the Compose files keep on the internal network.                                                                                                                                                         |

Browsers on another origin: a page on another origin can never use a signed-in Studio session unless its origin is in `CORS_ORIGIN`, and the API refuses writes (`POST`, `PUT`, `PATCH`, `DELETE`) that a page on another origin sends without an `Authorization` header, since those could only be riding on the cookie or on `AUTH_DISABLED`.

## Rate limits

The backend limits API calls per minute, in its own memory (one backend process, so one set of counters; a restart resets them).

| Variable                   | Default | Description                                                                                                                                                                                    |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_IP_RATE_LIMIT`        | `600`   | Calls per client address per minute that carry no valid key or session: the sign-in routes, the API spec and docs, and failed authentication. Calls that authenticate do not count against it. |
| `API_KEY_RATE_LIMIT_MAX`   | `10000` | The highest `rate_limit` a key can be created with, and the most any key gets, whatever it was created with.                                                                                   |
| `API_KEYS_PER_ACCOUNT_MAX` | `100`   | Usable keys one account can hold; creating one more answers `409`.                                                                                                                             |

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

| Variable                  | Default    | Description                                                                         |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `RECONCILE_ENABLED`       | `true`     | Periodically compare the database with the indexer's pinned objects and flag drift. |
| `RECONCILE_INTERVAL_MS`   | 1 hour     | How often reconciliation runs.                                                      |
| `DELETION_GC_ENABLED`     | `true`     | Re-drive deletions that stopped half way, for example after a crash.                |
| `DELETION_GC_INTERVAL_MS` | 15 minutes | How often that sweep runs.                                                          |

The schedules live in Redis and are brought in line with these settings at every backend start: a changed interval replaces the schedule, and `false` removes it.

## Production override

Read by `docker-compose.prod.yml` only.

| Variable            | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `DOMAIN`            | The domain Caddy gets a certificate for. `PUBLIC_URL` becomes `https://$DOMAIN`. |
| `ACME_EMAIL`        | Contact address for Let's Encrypt.                                               |
| `POSTGRES_PASSWORD` | Password for the `sluby` database user.                                          |

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

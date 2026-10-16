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

| Variable               | Default | Description                                                                                                                                                                                                                                                                           |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_DISABLED`        | `false` | `true` signs every visitor in as a local user with full access. The backend refuses to start with it in production.                                                                                                                                                                   |
| `SESSION_SECRET`       |         | Signs session cookies. At least 32 characters in production.                                                                                                                                                                                                                          |
| `GITHUB_CLIENT_ID`     |         | GitHub OAuth app id.                                                                                                                                                                                                                                                                  |
| `GITHUB_CLIENT_SECRET` |         | GitHub OAuth app secret.                                                                                                                                                                                                                                                              |
| `GITHUB_ALLOWED_USERS` |         | Comma-separated GitHub logins allowed to sign in. Empty lets any GitHub account in, each with its own library.                                                                                                                                                                        |
| `BOOTSTRAP_API_KEY`    |         | A raw `sluby_...` key seeded with every scope at startup whenever that key is not already in the database. Deleting it brings it back on the next start; rotating it retires it for good. It belongs to its own `platform` account, so it does not see assets uploaded in the Studio. |

## Server

| Variable            | Default                 | Description                                                                                                                                                                                |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_URL`        | `http://localhost:8080` | The URL browsers use. Upload and sign-in URLs are built from it.                                                                                                                           |
| `NODE_ENV`          | `development`           | `production` turns on the startup safety checks and JSON logs.                                                                                                                             |
| `WEB_PORT`          | `8080`                  | Local port for the web container (base Compose file only).                                                                                                                                 |
| `LOG_LEVEL`         | `info`                  | Backend log level: `trace`, `debug`, `info`, `warn`, `error`.                                                                                                                              |
| `CORS_ORIGIN`       |                         | Comma-separated origins allowed to call the API from a browser. Unset reflects any origin. The session cookie is `SameSite=Lax`, so other sites never get signed-in access either way.     |
| `MAX_UPLOAD_SIZE`   | 10 GiB                  | Largest accepted upload, in bytes.                                                                                                                                                         |
| `CACHE_MAX_SIZE_MB` | 10 GiB                  | Size bound, in megabytes, of the gateway's in-memory cache of whole objects (manifests and thumbnails fetched without a `Range` header). It counts against the backend container's memory. |

Rate limits are not an environment setting: each API key carries its own requests-per-minute limit, set with `rate_limit` when the key is created (100 when left out), and Studio sessions get 1000.

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

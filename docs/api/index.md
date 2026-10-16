# API overview

Sluby's REST API lives under `/api/v1` on the same host as the Studio, and the Studio itself is built on it. The API is described by an OpenAPI 3.1 document that your server publishes at `/api/v1/openapi.json`. Two references are generated from that document:

- the [API reference](/api/reference) on this site, which can send requests to any Sluby server you point it at
- the reference your own server renders at `/api/v1/docs` (for the quickstart stack, [http://localhost:8080/api/v1/docs](http://localhost:8080/api/v1/docs)), which sends requests to that server

Both list every endpoint with its parameters, request and response schemas, and the scope it needs. The document this site uses is also available as [openapi.json](/openapi.json) for code generators and API clients.

## Authentication

Programmatic calls authenticate with an API key, sent as a bearer token:

```sh
curl -H "Authorization: Bearer sluby_..." http://localhost:8080/api/v1/assets
```

Keys start with `sluby_`. The server stores only a SHA-256 hash of each key, so the secret is shown once, when the key is created or rotated, and cannot be retrieved later.

The Studio does not use a key. It signs in with GitHub and sends a session cookie, which the server checks before the `Authorization` header. When `AUTH_DISABLED=true` (the quickstart default), every request is treated as a signed-in local user and keys are not checked at all.

### Creating a key

In the Studio, open **Settings** and find the **API keys** card. Click **Create key**, give the key a name, pick its scopes and a rate limit in requests per minute, then copy the secret from the dialog that follows. New keys get the `upload` and `read` scopes and a limit of 100 requests per minute unless you change them.

The same card rotates and revokes keys. Rotating issues a new secret with the same name, scopes and limit. The old secret stops working immediately or after a grace period of up to 7 days, which gives running clients time to switch. A key can be rotated once; to rotate again, rotate its replacement.

Keys can also be managed through the API (`POST /api/v1/keys`, `POST /api/v1/keys/{id}/rotate`, `DELETE /api/v1/keys/{id}`) with a key that has the `manage` scope. To get a first key without signing in to the Studio, set `BOOTSTRAP_API_KEY` to a `sluby_...` value of your choice before starting the backend. It is stored with all three scopes and a limit of 1000 requests per minute (see [Configuration](/guide/configuration)).

### Scopes

Each key carries one or more scopes, and every endpoint requires exactly one:

| Scope    | Allows                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload` | Uploading videos over tus at `/api/v1/uploads` and cancelling an upload.                                                                     |
| `read`   | Listing and reading assets, renditions, processing state and Sia storage details, playback URLs, upload status, webhooks, stats and metrics. |
| `manage` | Editing, deleting and retrying assets, playback IDs, API keys, creating and deleting webhooks, and reconciliation (see below).               |

Scopes are checked independently: `manage` does not include `read`, so a key that should do both needs both. A key without the required scope gets `403` with `Requires '<scope>' scope`. Each operation in the reference shows its scope as `x-required-scope`.

### Accounts

Every resource belongs to the account that created it, and a request only reaches its own account's assets, keys, webhooks and playback IDs. An ID from another account answers `404`, the same as one that does not exist. The exception is a key with the platform address (`0x` followed by 64 zeros), which acts across all accounts (see [tenancy](/architecture/auth-and-tenancy#tenancy)).

The reconciliation report (`GET /api/v1/reconciliation`) is the one place that covers every account, since a run compares the whole database with the shared indexer. Its counts and status are the same for every caller, but its object IDs are scoped: an ordinary account gets `"scope": "account"`, with `missing_ids` and `account_missing_count` limited to its own assets and no `orphaned_ids`, because an orphaned object belongs to no asset. Only a key with the platform address gets `"scope": "deployment"` and the full lists. `POST /api/v1/reconciliation/run` queues a run only when none is already waiting or running, and says which happened in `enqueued` and `already_pending`. See [deletion and reconciliation](/architecture/deletion-and-reconciliation#what-each-caller-sees) for the details.

## Pagination

`GET /api/v1/assets` is the paginated list. It takes `limit` (1 to 100, default 20) and returns a page with a cursor for the next one:

```json
{
  "data": [],
  "total": 42,
  "page": 1,
  "limit": 20,
  "next_cursor": "eyJjIjoiMjAyNi0xMC0wNlQx...",
  "has_more": true
}
```

To fetch the next page, pass `next_cursor` back as `cursor`, and stop when `has_more` is `false`. Cursors stay correct when videos are added or deleted between requests. `total` is the number of assets that match the filters.

Cursor paging only works with the default order (`sort=created_at`, `order=desc`). With any other order `next_cursor` is `null`, a `cursor` is rejected with `400`, and you page with `page` (1-based) instead. A cursor the server cannot read is ignored, and the request is answered as if it had none.

Other lists (`GET /api/v1/keys`, `GET /api/v1/webhooks`, playback IDs) return `{ "data": [...] }` without paging.

## Errors

Errors are JSON with an `error` message:

```json
{ "error": "Requires 'manage' scope" }
```

| Status | Meaning                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid input, such as an unknown filter value, a bad request body or an ID that is not a valid identifier (`Invalid identifier format`). |
| `401`  | The `Authorization` header is missing, or the key is unknown, deactivated or expired.                                                     |
| `403`  | The key lacks the scope the endpoint requires.                                                                                            |
| `404`  | The resource does not exist or belongs to another account. Unknown routes also return `404`.                                              |
| `429`  | Rate limit exceeded (see below).                                                                                                          |
| `500`  | Server error. The details go to the backend log.                                                                                          |

Some errors carry a `message` with more detail. When `NODE_ENV` is not `production`, errors raised inside a route handler also include `message` and `stack` to help while developing, so a production server never returns a stack trace.

## Rate limits

Each API key has its own limit in requests per minute, set when the key is created. Studio sessions get 1000. Requests are counted in fixed one-minute windows, and every counted response carries:

| Header                  | Value                                |
| ----------------------- | ------------------------------------ |
| `X-RateLimit-Limit`     | The key's limit per minute.          |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset`     | Seconds until the window resets.     |

Over the limit, the server answers `429` with a `Retry-After` header in seconds and a body like `{ "error": "Rate limit exceeded", "retryAfter": 37 }`. `@sluby/sdk` raises this as a `RateLimitError` with `retryAfter` set.

The limit applies to the endpoints under `/api/v1` that need a key. The OpenAPI document, the reference page, sign-in, tus upload traffic and the delivery routes under `/v1` are not counted. Counters live in the backend process's memory, so they reset when the backend restarts.

## Trying requests

In either reference, open an endpoint, click **Test Request**, paste your key into **Bearer Token** and press **Send**. The reference on your own server calls that server directly. If you are signed in to the Studio in the same browser, those requests also carry your session cookie, and the session takes precedence over the key.

The reference on this site sends requests from your browser to the server set in its server field (`http://localhost:8080` by default). The backend allows any origin unless `CORS_ORIGIN` is set, in which case the docs site's origin must be in that list.

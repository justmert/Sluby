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

The Studio does not use a key. It signs in with GitHub and sends a session cookie, which the server checks before the `Authorization` header. When `AUTH_DISABLED=true` (the quickstart default), every request is treated as the local dev account and keys are not checked at all.

A key belongs to an account and works only while that account may use the server: taking someone off the sign-in allowlist makes their keys answer `401` until they are put back (see [the allowlist](/architecture/auth-and-tenancy#the-allowlist)).

### Creating a key

In the Studio, open **Settings** and find the **API keys** card. Click **Create key**, give the key a name, pick its scopes and a rate limit in requests per minute, then copy the secret from the dialog that follows. New keys get the `upload` and `read` scopes and a limit of 100 requests per minute unless you change them.

The same card rotates and revokes keys. Rotating issues a new secret with the same name, scopes and limit. The old secret stops working immediately or after a grace period of up to 7 days, which gives running clients time to switch. A key can be rotated once; to rotate again, rotate its replacement.

Keys can also be managed through the API (`GET /api/v1/keys`, `POST /api/v1/keys`, `PATCH /api/v1/keys/{id}` to rename, `POST /api/v1/keys/{id}/rotate`, `DELETE /api/v1/keys/{id}`) with a key that has the `manage` scope, or with `client.keys` in `@sluby/sdk`. To get a first key without signing in to the Studio, set `BOOTSTRAP_API_KEY` to a `sluby_...` value of your choice before starting the backend. It is stored with all three scopes and a limit of 1000 requests per minute, once: deleted or rotated, it is never seeded again. A listed key shows its `prefix` (the first 12 characters) and `last_used_at` (to the minute), so you can tell which key a server holds and which old key is safe to revoke, and the list answers the server's `limits` (`max_keys`, `max_rate_limit`). In production the bootstrap key must look like a generated key (`sluby_` and at least 32 more letters, digits, `-` or `_`). See [Configuration](/guide/configuration).

### Scopes

Each key carries one or more scopes, and every endpoint requires exactly one:

| Scope    | Allows                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `upload` | Uploading videos over tus at `/api/v1/uploads` and cancelling an upload.                                                                 |
| `read`   | Listing and reading assets, renditions, processing state and Sia storage details, playback URLs, upload status, stats and system status. |
| `manage` | Editing, deleting and retrying assets, playback ids, API keys, webhooks (listing them too) and reconciliation (see below).               |

Scopes are checked independently: `manage` does not include `read`, so a key that should do both needs both. Keep every key on a server, a `read` key included: `read` mints signed URLs and share maps, so it plays every private asset of its account. A key without the required scope gets `403` with `Requires '<scope>' scope`. Each operation in the reference shows its scope as `x-required-scope`.

### Accounts

Every resource belongs to the account that created it, and a request only reaches its own account's assets, keys, webhooks and playback ids. An id from another account answers `404`, the same as one that does not exist. The exception is a key with the platform address (`0x` followed by 64 zeros), which acts across all accounts (see [tenancy](/architecture/auth-and-tenancy#tenancy)).

The platform key also lists, reads and changes the resources of every account, keys included, through the same endpoints.

Deployment-wide operations data is for the platform key and for operators: the accounts listed in `OPERATOR_USERS` (see [operators](/architecture/auth-and-tenancy#operators)), through their Studio sessions and their API keys. An operator sees the deployment, but like any other account only its own assets, keys, webhooks and playback ids:

- `GET /api/v1/system/status` answers every caller, but an ordinary account gets `"scope": "account"`: a health summary (whether the database, Redis and the indexer answer, and the size of the host pool), without the indexer account, the indexer URL, probe error text, uptime, the delivery cache or the last reconciliation. The platform key and operators get `"scope": "deployment"` and all of it.
- `GET /api/v1/metrics` counts the whole process, every account together, so it answers `403` to anyone but the platform key and operators.
- `GET /api/v1/reconciliation` gives an ordinary account `"scope": "account"`: the run's times, a `status` about its own assets (`drift` when objects of its assets are missing, `failed` when the run itself failed), and `missing_count`, `missing_ids` and `missing_objects` (each missing id with the `video_asset_id` and `title` of its video, null when no live video holds it) for its own assets only. The platform key and operators get `"scope": "deployment"` with the deployment-wide counts, the error text of a failed run, and the full `missing_ids`, `missing_objects` and `orphaned_ids`. `POST /api/v1/reconciliation/run` scans the whole deployment, so only the platform key or an operator may start one; it queues a run only when none is already waiting or running, and says which happened in `enqueued` and `already_pending`. See [deletion and reconciliation](/architecture/deletion-and-reconciliation#what-each-caller-sees) for the details.

A platform key is one created by `npm run db:seed-key --workspace=backend -- --platform` (in the container, `node dist/db/seed-api-key.js --platform`), which owns the platform address. The `BOOTSTRAP_API_KEY` belongs to its own `platform` account, which is an ordinary account in this respect. A Studio session is never the platform identity, so the Studio shows the health summary unless the account is an operator. `GET /api/v1/auth/me` says which with `operator`. With `AUTH_DISABLED` the local account is an operator. Operations-only endpoints are marked `x-required-identity: operations` in the reference.

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

Cursor paging only works with the default order (`sort=created_at`, `order=desc`). With any other order `next_cursor` is `null`, a `cursor` is rejected with `400`, and you page with `page` (1-based, up to 1000000) instead. Send either `cursor` or `page`, not both; on a page fetched with a cursor, `page` is `null`. A cursor the server cannot read is a `400`, so a client never starts over at the first page by mistake.

Every query parameter may be given once. A repeated parameter, a `limit` outside 1 to 100, a `page` that is not a whole number and similar mistakes answer `400` instead of being replaced by a default.

`GET /api/v1/keys` pages the same way, newest first: `limit` (1 to 1000, default 1000) and `cursor`, with `has_more` and `next_cursor` in the answer. With the default limit one page holds every key of any ordinary account. `GET /api/v1/webhooks` and the playback ids of an asset return `{ "data": [...] }` without paging.

## Uploads

Uploads use the [tus](https://tus.io) protocol at `POST /api/v1/uploads`, as `@sluby/sdk` does. The creation answers `201` with the upload's URL in `Location`, built from `PUBLIC_URL`: `<PUBLIC_URL>/api/v1/uploads/<upload id>`. The upload id, the last segment of that URL, is also the id of the two REST operations on an upload (and the `uploadId` of an upload handle in `@sluby/sdk`):

- `GET /api/v1/uploads/{id}` (scope `read`) returns its `status` (`uploading`, `completed`, `cancelled` or `failed`), `progress_percent`, `file_size`, `uploaded_bytes` and `video_asset_id`.
- `DELETE /api/v1/uploads/{id}` (scope `upload`) cancels an upload that is still in progress: the partial file and the asset it created are removed, as with a tus `DELETE`. An upload that has finished is the source its asset is processed and retried from, so it cannot be cancelled (`409`, or `400` for a tus `DELETE`); delete the asset instead, which needs `manage`.

A file type other than `video/*` answers `415`. The creation metadata is checked like an asset edit: `accessTier` (or `access_tier`) must be `public` or `private`, `title` at most 200 characters and `description` at most 5000, neither with control characters, and an empty file (`Upload-Length: 0`) is refused. Each mistake answers `400` and creates nothing. An upload left unfinished for 24 hours expires: its file is removed, its session marked `failed`, and the asset it created is deleted.

## Signed playback URLs

`GET /api/v1/playback/{id}/signed` (scope `read`) mints a URL for a private asset's master manifest, with `expires` and `sig` in its query, and `poster_url`, the first thumbnail signed the same way (or null). `expires_in` is in seconds, defaults to 3600 and is kept between 60 and 21600 (six hours): a larger or smaller whole number is brought to that bound, and anything that is not a whole number is a `400`. `expires_at` in the answer says what was minted. A URL never works for longer than six hours.

A signature is bound to the asset's signing generation, which goes up when the asset's tier changes and on `POST /api/v1/playback/{id}/signed/revoke` (scope `manage`). Either makes every URL signed for the asset so far, and every playlist and segment URL signed from one, answer `403` from then on; new URLs can be minted straight away. Revoking does not touch sia:// share maps already handed out for direct-from-Sia playback, which run until their own expiry (at most an hour for a private asset).

The gateway serves a public asset to anyone. After `PATCH` makes it private, or `DELETE` removes it, the backend refuses at once, and copies the shipped nginx keeps are refused within 60 seconds, when they are next revalidated (see [Playback](../architecture/playback#how-long-an-access-change-takes)). A `signed` playback id only gates its own `/v1/stream` and `/v1/share` entries: on a public asset, the objects stay public under their own ids, so it does not make the video private.

## Errors

Errors are JSON with an `error` message. A `400` from a body or query that failed validation also lists every problem in `details`:

```json
{
  "error": "title: title must be at most 200 characters",
  "details": [{ "field": "title", "message": "title must be at most 200 characters" }]
}
```

| Status | Meaning                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | Invalid input, such as an unknown filter value, a repeated query parameter, a bad request body or an id that is not a valid identifier (`Invalid identifier format`).                                                                                  |
| `401`  | The `Authorization` header is missing, or the key is unknown, deactivated, expired or owned by an account no longer allowed in. Without a key the body adds `reason`: `missing`, `expired`, `revoked` or `not_allowed`, why the browser session ended. |
| `403`  | The key lacks the scope the endpoint requires, the endpoint is for the platform identity and operators only, or a write came from another origin without an `Authorization` header.                                                                    |
| `404`  | The resource does not exist or belongs to another account. Unknown routes also return `404`, with or without a key.                                                                                                                                    |
| `409`  | The request conflicts with the resource's state, such as playing an asset that is not ready, cancelling a finished upload or resending to a paused webhook.                                                                                            |
| `412`  | `PATCH /api/v1/assets/{id}` with `If-Match`: the asset changed since that version. Nothing was saved; the body's `current` is the asset as it is now.                                                                                                  |
| `429`  | Rate limit exceeded (see below).                                                                                                                                                                                                                       |
| `500`  | Server error. The details go to the backend log.                                                                                                                                                                                                       |
| `502`  | The Sia indexer did not answer, for example while minting share URLs.                                                                                                                                                                                  |
| `503`  | The database did not answer while minting share URLs.                                                                                                                                                                                                  |

### Editing without lost updates

`GET` and `PATCH /api/v1/assets/{id}` send an `ETag`, the asset's `updated_at` in milliseconds since the epoch, quoted (`"1767225600000"`), so it can also be built from any listing. Behind the bundled nginx a compressed answer carries the weak form, `W/"1767225600000"`, and `If-Match` takes either. Send it back as `If-Match` on `PATCH` and the edit applies only if nobody changed the asset since; otherwise the answer is `412` with the asset as it is now in `current` and its new `ETag`, and you can merge and send again. Without `If-Match` the edit applies as before. Processing changes the version too. In `@sluby/sdk`: `assets.update(id, data, { ifMatch: asset })`, which rejects with a `ConflictError` whose `statusCode` is 412 and whose `current` is the asset.

When the backend runs with `EXPOSE_ERROR_STACKS=true`, errors raised inside a route handler also include `message` and `stack` to help while debugging. It is off by default in every setup, so a server never returns a stack trace unless you turn it on. Each operation in the reference lists the status codes it can answer, and the backend's tests check every answer against that list.

## Webhooks

`POST /api/v1/webhooks` (scope `manage`) registers a receiver URL for some of the events listed under [webhooks and processing logs](/architecture/upload-pipeline#webhooks-and-processing-logs) and returns its signing secret once. Events are sent only for the account's own assets.

The URL must be `http` or `https`, and its host must resolve only to public addresses. Loopback, private (RFC 1918), link-local and cloud metadata (`169.254.0.0/16`, `fd00:ec2::254`), unique local, CGNAT (`100.64.0.0/10`), unspecified, multicast and the other special-purpose ranges are refused, including IPv6 forms that carry such an IPv4 address (`::ffff:127.0.0.1`). The check runs at registration and again before every delivery, and the request then connects only to the addresses that were checked, so a DNS answer that changes in between cannot point it inside the deployment. Redirects are not followed. To deliver to receivers on your own network, list their networks in `WEBHOOK_ALLOWED_NETWORKS` (see [Configuration](/guide/configuration#webhooks)).

Each delivery is a `POST` with a JSON body and these headers:

| Header                 | Value                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Sluby-Event`        | The event name, such as `asset.ready`.                                                                                                                         |
| `X-Sluby-Delivery`     | An id for this delivery to this endpoint, the same on every retry of it.                                                                                       |
| `X-Sluby-Timestamp`    | When this attempt was sent, in Unix seconds.                                                                                                                   |
| `X-Sluby-Signature-V1` | Hex HMAC-SHA256, with the endpoint secret, of the timestamp, a `.`, and the raw body.                                                                          |
| `X-Sluby-Signature`    | Hex HMAC-SHA256 of the raw body alone. Deprecated: it binds no time, so a captured request keeps verifying. Kept so receivers written against it keep working. |

The body is `{ "id": "evt_...", "event": "asset.ready", "timestamp": "...", "data": { ... } }`. Delivery is at least once (retries after 10 s, 1 min and 5 min, and a request in flight when the backend stops is sent again), so drop an `id` you have already handled.

To verify a request, compute the HMAC of `<X-Sluby-Timestamp>.<raw body>` with the secret, compare it with `X-Sluby-Signature-V1` in constant time, and refuse a timestamp more than five minutes from your clock. `@sluby/sdk` does this in `verifyRequest`:

```ts
import type { IncomingHttpHeaders } from 'node:http';
import { WebhookManager, type WebhookEvent } from '@sluby/sdk';

const webhooks = new WebhookManager();

// rawBody must be the request body exactly as received, not parsed JSON
export function readEvent(rawBody: string, headers: IncomingHttpHeaders): WebhookEvent | null {
  if (!webhooks.verifyRequest(rawBody, headers, process.env.SLUBY_WEBHOOK_SECRET!)) {
    return null; // answer 401
  }
  return webhooks.parseEvent(rawBody);
}
```

`verifyRequestAsync` does the same on Web Crypto, for edge runtimes and browsers, and takes a Fetch `Headers` object as well as Node's `req.headers`.

A receiver answers with any `2xx` status; anything else, a redirect included, counts as a failure and is retried. Only the status line counts: the response body is never read.

`POST /api/v1/webhooks/{id}/test` sends a signed `webhook.test` event (with `data.webhook_id`) right away and answers how the receiver responded (`delivered`, `status_code`, `error`). `GET /api/v1/webhooks/{id}/deliveries` lists the latest attempts with their event, status code and, for a failure, why. Both need `manage`, like listing endpoints, because receiver URLs often carry credentials. Each listed attempt also carries the `payload` that was sent and `manual` (true for a resend).

To manage an endpoint after creating it:

- `GET /api/v1/webhooks/{id}` answers one endpoint. Listed and single endpoints carry `last_delivery_at` and `last_delivery_ok`, how the newest attempt went.
- `PATCH /api/v1/webhooks/{id}` changes `url` (checked like at registration, at most 2,048 characters), `events`, or `is_active`: `false` pauses the endpoint, nothing is sent to it and queued deliveries are dropped; `true` resumes it for new events.
- `POST /api/v1/webhooks/{id}/rotate-secret` replaces the signing secret, for one that leaked, and returns the new one once. The old one stops at once, for queued retries too.
- `POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/redeliver` sends a logged delivery again, after you fixed your receiver: the stored payload with the same event `id`, so a receiver that handled it already can drop it. It answers `202` with the new `delivery_id` (the `X-Sluby-Delivery` it carries), or `409` while the endpoint is paused.

In `@sluby/sdk`, `client.webhookEndpoints` wraps these routes: `list`, `get`, `create`, `update`, `rotateSecret`, `redeliver`, `delete`, `test` and `deliveries`.

## Plays

Every asset carries `play_count` (all time) and `last_played_at`, and `GET /api/v1/stats/usage?days=30` (scope `read`, 1 to 90 days) answers the account's plays per UTC day, zero-filled, with their `total`. A play is one player load the server saw: the gateway serving a video's master playlist, or `/v1/share/{id}` minting the share map a direct-from-Sia player needs. The same viewer loading a video again within 30 minutes counts once, and previews in the Studio, HEAD, 304 and range requests do not count. Counts reach the API within about 10 seconds. See [Playback](/architecture/playback#plays) for the details and limits.

## Rate limits

Each API key has its own limit in requests per minute, set when the key is created and capped by the server's `API_KEY_RATE_LIMIT_MAX` (10000 by default). Studio sessions get 1000. Requests are counted in fixed one-minute windows, and every counted response carries:

| Header                  | Value                                |
| ----------------------- | ------------------------------------ |
| `X-RateLimit-Limit`     | The limit per minute.                |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset`     | Seconds until the window resets.     |

Over the limit, the server answers `429` with a `Retry-After` header in seconds and a body like `{ "error": "Too many requests. Try again in a few seconds.", "retry_after": 37 }`. The body also carries the older `retryAfter` spelling, so clients written for 0.1.0 keep working. `@sluby/sdk` raises this as a `RateLimitError` with `retryAfter` set from the header.

Calls under `/api/v1` that carry no valid key or session (the OpenAPI document, the reference page, sign-in, and any call whose authentication fails) are counted per client address instead, 600 a minute by default (`API_IP_RATE_LIMIT`). Calls that authenticate are not counted there. Counters live in the backend process's memory, so they reset when the backend restarts. In front of the backend, the web proxy also limits each client address on the delivery routes under `/v1` and on sign-in; see [configuration](/guide/configuration#web-proxy).

An account can hold at most 100 usable keys by default (`API_KEYS_PER_ACCOUNT_MAX`); creating one more answers `409`.

## Trying requests

In either reference, open an endpoint, click **Test Request**, paste your key into **Bearer Token** and press **Send**. The reference on your own server calls that server directly. If you are signed in to the Studio in the same browser, those requests also carry your session cookie, and the session takes precedence over the key.

The reference on this site sends requests from your browser to the server set in its server field (`http://localhost:8080` by default). The backend lets any origin call it with a key, without cookies, so that works once you paste a key. It does not while the server runs with `AUTH_DISABLED=true` (the quickstart default): other origins then get no CORS at all, so use the reference on your own server instead.

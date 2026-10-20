# Sluby REST API

Contents: base URL and authentication, scopes, endpoints, errors, listing and paging, ETags, rate limits.

The server publishes its full OpenAPI document at `/api/v1/openapi.json` and an interactive reference at `/api/v1/docs`. Both are public. Read them for every field this file does not list.

## Base URL and authentication

- The API lives under `/api/v1` on the Sluby server, for example `https://sluby.example.com/api/v1/assets`.
- Send the key as a bearer token: `Authorization: Bearer sluby_...`.
- JSON bodies use `Content-Type: application/json`. Field names in requests and responses are snake_case (`access_tier`, `video_asset_id`). The SDK maps them to camelCase.
- Playback and the watch page live outside `/api/v1`, at `/v1/stream/...`, `/v1/objects/...` and `/watch/...`. They take no key; see `references/playback.md`.

```sh
curl -s https://sluby.example.com/api/v1/assets?limit=5 \
  -H "Authorization: Bearer $SLUBY_API_KEY"
```

## Scopes

A key carries one or more scopes. A request without the needed scope gets `403` with `{"error":"Requires 'manage' scope"}` (the scope name varies).

| Scope    | Allows                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload` | Create, resume and cancel tus uploads (`POST`, `HEAD`, `PATCH`, `DELETE` on `/api/v1/uploads`)                                                  |
| `read`   | List and get assets, their processing state and renditions, upload status, playback URLs (plain and signed), playback ids (list), library stats |
| `manage` | Edit, retry and delete assets; create and delete playback ids; revoke signed URLs; webhook endpoints; API keys                                  |

A key also acts with the role of the member who made it. Endpoints for members, invites and metrics answer `403` to a key whose maker is not an admin.

## Endpoints you use most

| Method and path                                    | Scope    | What it does                                                                |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `POST /api/v1/uploads` (tus)                       | `upload` | Start an upload; creates the asset. See `references/uploads.md`             |
| `GET /api/v1/uploads/{id}`                         | `read`   | Upload status, including `video_asset_id`                                   |
| `DELETE /api/v1/uploads/{id}`                      | `upload` | Cancel an unfinished upload and discard its asset                           |
| `GET /api/v1/assets`                               | `read`   | List assets                                                                 |
| `GET /api/v1/assets/{id}`                          | `read`   | One asset, with an `ETag` header                                            |
| `PATCH /api/v1/assets/{id}`                        | `manage` | Change `title`, `description`, `access_tier`                                |
| `DELETE /api/v1/assets/{id}`                       | `manage` | Delete; answers `{"success":true,"status":"deleting"}`                      |
| `GET /api/v1/assets/{id}/processing`               | `read`   | Stage, percent, error message, log lines, `retryable`                       |
| `POST /api/v1/assets/{id}/retry`                   | `manage` | Re-run failed processing; answers the `stage` it restarted from             |
| `GET /api/v1/playback/{id}`                        | `read`   | Unsigned manifest path, poster path, duration, tier                         |
| `GET /api/v1/playback/{id}/signed?expires_in=3600` | `read`   | Signed manifest URL, signed poster URL, `expires_at`                        |
| `POST /api/v1/playback/{id}/signed/revoke`         | `manage` | Stop every signed URL of the asset minted so far                            |
| `GET /api/v1/assets/{id}/playback-ids`             | `read`   | List playback ids                                                           |
| `POST /api/v1/assets/{id}/playback-ids`            | `manage` | Create one: `{"policy":"public"}` or `{"policy":"signed"}`, optional `name` |
| `DELETE /api/v1/playback-ids/{playbackId}`         | `manage` | Delete a playback id                                                        |
| `GET`, `POST /api/v1/webhooks`                     | `manage` | List or create webhook endpoints                                            |
| `GET`, `POST /api/v1/keys`                         | `manage` | List or create API keys                                                     |

`{id}` in the `/api/v1/playback` paths takes an asset id or a `pb_...` playback id.

## Asset statuses

`created`, then `uploading`, `processing`, and finally `ready` or `failed`. Only a `ready` asset plays. The processing endpoint names the step: `queued`, `transcode`, `upload`, `finalize`, `completed` or `failed`.

## Errors

Every REST error body is JSON with an `error` message, for example `{"error":"Video asset not found"}`. The tus upload protocol on `/api/v1/uploads` answers its errors in plain text instead (see `references/uploads.md`). Some JSON errors add fields: a `429` adds `retry_after`, a `412` adds `current`.

| Status | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| 400    | Bad input (unknown filter value, malformed `If-Match`, bad `expires_in`)                           |
| 401    | No key, unknown key, revoked or expired key, or a key whose creator was removed from the workspace |
| 403    | The key lacks the scope, or the action is for admins                                               |
| 404    | No such resource in this workspace                                                                 |
| 409    | Wrong state, for example playback of an asset that is not `ready`                                  |
| 412    | `If-Match` did not match; `current` holds the asset as it is now                                   |
| 429    | Rate limit reached                                                                                 |

## Listing assets and paging

`GET /api/v1/assets` takes these query parameters:

| Parameter     | Values                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| `limit`       | 1 to 100, default 20                                                                  |
| `page`        | page number, default 1                                                                |
| `cursor`      | the `next_cursor` of the previous page                                                |
| `status`      | `created`, `uploading`, `processing`, `ready`, `failed`                               |
| `access_tier` | `public`, `private`                                                                   |
| `search`      | up to 200 characters; matches title or description without case, or an exact asset id |
| `sort`        | `created_at` (default), `title`, `duration`, `size`                                   |
| `order`       | `desc` (default), `asc`                                                               |

The answer has `data`, `total`, `page`, `limit`, `next_cursor` and `has_more`. Use `cursor` to walk a whole library: pass each `next_cursor` back until it is `null`. Cursor paging works only with the default order (`created_at`, `desc`), and a request with both `cursor` and `page` gets `400`.

## ETags and safe edits

`GET` and `PATCH /api/v1/assets/{id}` return an `ETag` such as `"1767225600000"`. Send it back as `If-Match` on `PATCH`, and the edit applies only if nobody changed the asset since you read it. Otherwise the answer is `412` with the current asset in `current`. In the SDK, pass `{ ifMatch: asset }` to `assets.update` and catch `ConflictError`, whose `current` holds the asset.

## Rate limits

Each authenticated response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the window resets). The window is one minute per key. Over the limit the server answers `429` with `Retry-After` in seconds. Requests without a valid key share a separate per-IP limit. Requests of the tus upload protocol (`POST`, `HEAD`, `PATCH` on `/api/v1/uploads`) do not count against the key's limit.

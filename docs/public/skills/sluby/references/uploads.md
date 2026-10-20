# Uploading videos to Sluby

Contents: what the server accepts, the SDK upload handle, resuming in the browser, uploading with any tus client, uploading with curl, after the upload.

Every upload goes through the tus 1.0.0 protocol at `POST /api/v1/uploads` and needs a key with the `upload` scope. The server creates the video asset as the upload starts, so there is no separate "create asset" call.

## What the server accepts

| Rule                                                                              | Server answer when broken                    |
| --------------------------------------------------------------------------------- | -------------------------------------------- |
| File type, when the client sends one, starts with `video/`                        | `415` "Only video files are accepted"        |
| The file is not empty                                                             | `400` "The file is empty"                    |
| Size up to the server's `MAX_UPLOAD_SIZE` (10 GiB unless the operator changed it) | `413` "Maximum size exceeded"                |
| `title` up to 200 characters; missing or blank becomes `Untitled`                 | `400`                                        |
| `description` up to 5000 characters                                               | `400`                                        |
| `accessTier` is `public` or `private`, default `public`                           | `400` "accessTier must be public or private" |

An unfinished upload stays resumable for 24 hours from its creation. After that the server deletes it.

## The SDK upload handle

`sluby.uploads.upload(file, options)` starts at once and returns a handle:

| Member            | What it is                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `await handle`    | Resolves when every byte is on the server. Rejects with a `SlubyError` (an `AbortError` after `abort()`)      |
| `handle.assetId`  | Promise of the new asset's id; resolves once the server has created the upload, before the bytes finish       |
| `handle.uploadId` | Promise of the upload's id, for `uploads.getStatus(id)` and `uploads.cancel(id)`                              |
| `handle.pause()`  | Stops sending and keeps the partial upload                                                                    |
| `handle.resume()` | Continues a paused upload where it stopped                                                                    |
| `handle.abort()`  | Cancels an unfinished upload: the server discards the asset it created. Does nothing once the upload finished |
| `handle.isPaused` | Whether the upload is paused                                                                                  |

Options besides `title`, `description` and `accessTier`: `onProgress(percent, bytesUploaded, bytesTotal)`, `onSuccess()`, `onError(error)`, `chunkSize` (bytes, default 10 MiB), `retryDelays` (milliseconds, default `[0, 1000, 3000, 5000]`), `signal` (an `AbortSignal` that aborts the upload) and `resume` (default `true`).

In Node, pass a `Buffer`, a `Uint8Array`, or a `Blob` from `fs.openAsBlob(path, { type: 'video/mp4' })`. Node streams are not accepted.

## Resuming in the browser

In a browser the SDK remembers unfinished uploads in `localStorage`. When you upload the same file again with the same title, description, tier and key after a page reload, the SDK resumes the unfinished upload instead of starting over. An upload that already finished is never resumed: the file uploads again as a new asset. Pass `resume: false` to always start a new upload.

## Uploading with any tus client

Any tus 1.0.0 client works. Point it at `https://sluby.example.com/api/v1/uploads`, send `Authorization: Bearer <key>` on every request, and set these `Upload-Metadata` keys:

| Key           | Value                                            |
| ------------- | ------------------------------------------------ |
| `filename`    | The file name, for example `talk.mp4`            |
| `filetype`    | A `video/...` MIME type                          |
| `title`       | The video's title                                |
| `description` | Optional                                         |
| `accessTier`  | `public` or `private` (`access_tier` also works) |

Do not upload one file in parallel parts: the server makes one asset per tus upload.

## Uploading with curl

tus metadata values are base64. This script creates the upload, sends the file in one `PATCH`, and reads the asset id:

```sh
b64() { printf %s "$1" | base64 | tr -d '\n'; }
FILE=talk.mp4
SIZE=$(wc -c < "$FILE" | tr -d ' ')

# 1. create the upload; the answer is 201 with a Location header
LOCATION=$(curl -s -D - -o /dev/null -X POST https://sluby.example.com/api/v1/uploads \
  -H "Authorization: Bearer $SLUBY_API_KEY" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: $SIZE" \
  -H "Upload-Metadata: filename $(b64 "$FILE"),filetype $(b64 video/mp4),title $(b64 'Conference talk'),accessTier $(b64 private)" \
  | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')

# 2. send the bytes
curl -s -X PATCH "$LOCATION" \
  -H "Authorization: Bearer $SLUBY_API_KEY" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Offset: 0" \
  -H "Content-Type: application/offset+octet-stream" \
  --data-binary @"$FILE"

# 3. the upload id is the last part of the Location; its status names the asset
UPLOAD_ID=${LOCATION##*/}
curl -s https://sluby.example.com/api/v1/uploads/$UPLOAD_ID \
  -H "Authorization: Bearer $SLUBY_API_KEY"
# {"id":"...","video_asset_id":"...","status":"completed",...}
```

To resume after a broken connection, ask how much arrived with `HEAD $LOCATION` (same `Authorization` and `Tus-Resumable` headers), read `Upload-Offset` from the answer, and send the rest with `PATCH` and that offset. The status call in step 3 needs the `read` scope.

## After the upload

Processing starts by itself when the last byte arrives. Follow it in one of three ways:

- `sluby.assets.waitForReady(assetId)` polls until `ready`.
- `GET /api/v1/assets/{id}` and read `status`; `GET /api/v1/assets/{id}/processing` gives the stage, percent, error and log.
- Subscribe a webhook endpoint to `asset.ready` and `asset.errored` (see `references/webhooks.md`).

When processing fails, `processing` reports `retryable`. If it is `true`, `sluby.assets.retry(id)` (or `POST /api/v1/assets/{id}/retry`, `manage` scope) runs it again from the furthest step it can.

# Sluby webhooks

Contents: events, registering an endpoint, the request Sluby sends, verifying it with the SDK, verifying it without the SDK, retries and duplicates, managing endpoints.

## Events

| Event                | When                                                 | `data` includes                                                               |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `upload.started`     | The server created an upload                         | `video_asset_id`, `upload_id`, `file_size`                                    |
| `upload.completed`   | The last byte arrived                                | `video_asset_id`, `upload_id`, `file_size`, `sha256`                          |
| `upload.failed`      | The server could not take a finished upload          | `video_asset_id`, `upload_id`, `error`                                        |
| `processing.started` | Processing began, also when a retry starts a new run | `video_asset_id`                                                              |
| `asset.ready`        | The video plays                                      | `video_asset_id`, `manifest_object_id`, `duration_ms`, `resolution`, `status` |
| `asset.errored`      | Processing failed                                    | `video_asset_id`, `stage`, `error`                                            |

The body is JSON: `{ "id": "...", "event": "asset.ready", "timestamp": "<ISO 8601>", "data": { ... } }`. `id` is the same on every retry of one event.

## Register an endpoint

Needs a key with the `manage` scope. The URL is an absolute `http` or `https` URL whose host resolves to public addresses (the server's operator can allow private networks). People can also add endpoints in the Studio under **Developers**, **Webhooks**.

```ts
import { SlubyClient } from '@sluby/sdk';

const sluby = new SlubyClient({
  baseUrl: process.env.SLUBY_URL!,
  apiKey: process.env.SLUBY_API_KEY!, // needs the manage scope
});

const endpoint = await sluby.webhookEndpoints.create({
  url: 'https://app.example.com/sluby-webhooks',
  events: ['asset.ready', 'asset.errored'],
});
console.log(endpoint.id, endpoint.secret); // store the secret now: it is never shown again

const result = await sluby.webhookEndpoints.test(endpoint.id);
console.log(result.delivered, result.statusCode, result.error);
```

`test` sends a signed `webhook.test` event right away and reports how your receiver answered.

## The request Sluby sends

A `POST` with `Content-Type: application/json` and these headers:

| Header                 | Value                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Sluby-Event`        | The event name                                                                                                                               |
| `X-Sluby-Delivery`     | The delivery's id                                                                                                                            |
| `X-Sluby-Timestamp`    | Unix time in seconds when Sluby signed the attempt                                                                                           |
| `X-Sluby-Signature-V1` | Hex HMAC-SHA256 of `<timestamp>.<raw body>` with the endpoint secret                                                                         |
| `X-Sluby-Signature`    | Hex HMAC-SHA256 of the body alone. Deprecated: it binds no time, so a captured request keeps verifying. Check `X-Sluby-Signature-V1` instead |

## Verify with the SDK

Verify against the raw body exactly as received, before any JSON parsing. A body that your code parsed and serialized again does not verify.

```ts
import { createServer } from 'node:http';
import { WebhookManager } from '@sluby/sdk';

const webhooks = new WebhookManager();
const secret = process.env.SLUBY_WEBHOOK_SECRET!; // returned once by webhookEndpoints.create
const handled = new Set<string>(); // use your database in production

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8'); // the raw body, before any JSON parsing

  if (!webhooks.verifyRequest(body, req.headers, secret)) {
    res.writeHead(401).end();
    return;
  }
  const event = webhooks.parseEvent(body);
  if (event.id && handled.has(event.id)) {
    res.writeHead(200).end(); // a retry of an event you already handled
    return;
  }
  if (event.event === 'asset.ready') {
    console.log('ready:', event.data.video_asset_id);
  }
  if (event.id) handled.add(event.id);
  res.writeHead(200).end();
}).listen(8081);
```

- `verifyRequest(rawBody, headers, secret, { toleranceSeconds })` takes Node's `req.headers` or a Fetch `Headers`. It refuses a timestamp more than 300 seconds from now unless you set `toleranceSeconds`.
- `verifyRequest` is for Node.js. In edge runtimes, Deno or browsers use `await webhooks.verifyRequestAsync(...)`, which runs on Web Crypto.
- In Express, read the body with `express.raw({ type: 'application/json' })` on the webhook route, not `express.json()`, and pass `req.body.toString('utf8')` as the raw body (`express.raw` gives a `Buffer`).

## Verify without the SDK

The same check in plain Node.js. Port it to any language with HMAC-SHA256:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// the same check as WebhookManager.verifyRequest, for code without the SDK
export function verifySluby(
  rawBody: string,
  timestamp: string | undefined, // X-Sluby-Timestamp
  signature: string | undefined, // X-Sluby-Signature-V1
  secret: string,
): boolean {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = signature.toLowerCase();
  return (
    given.length === expected.length &&
    /^[0-9a-f]+$/.test(given) &&
    timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))
  );
}
```

## Retries and duplicates

- Answer with any `2xx` status within 10 seconds. Anything else, or no answer, counts as a failed attempt.
- Sluby retries a failed delivery after 10 seconds, 1 minute and 5 minutes: four attempts in all. A `3xx` answer counts as a failure: Sluby does not follow redirects.
- One event can arrive more than once. Drop an event whose `id` you already handled.
- A paused or deleted endpoint gets nothing, retries included.

## Manage endpoints

All of these need the `manage` scope:

| SDK call                                                 | What it does                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `webhookEndpoints.list()`, `get(id)`                     | Endpoints, with how the newest delivery went                       |
| `webhookEndpoints.update(id, { url, events, isActive })` | Change the URL or events; `isActive: false` pauses, `true` resumes |
| `webhookEndpoints.rotateSecret(id)`                      | New signing secret, returned once; the old one stops at once       |
| `webhookEndpoints.deliveries(id, { limit })`             | The latest attempts, newest first, with the payload sent           |
| `webhookEndpoints.redeliver(id, deliveryId)`             | Send a logged delivery again, same event id                        |
| `webhookEndpoints.delete(id)`                            | Remove the endpoint                                                |

// a minimal signing backend for private videos: it holds a read-scoped api
// key and answers only the browser sdk's signed url call, for the assets it
// allows. public playback needs no server at all (client.playback.streamUrl),
// and direct-from-sia playback fetches its share map from sluby's public
// /v1/share with the signed url's signature, so the browser holds no key:
//
//   new SlubyClient({ baseUrl: 'http://localhost:8787', deliveryBaseUrl: SLUBY_PUBLIC_URL, sia })
//
//   SLUBY_BASE_URL=http://localhost:8080 SLUBY_API_KEY=sluby_... \
//   PLAYABLE_ASSET_IDS=<id>,<id> APP_ORIGINS=http://localhost:5181 \
//     node server/playback-server.mjs

import { createServer } from 'node:http';

const slubyUrl = (process.env.SLUBY_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const apiKey = process.env.SLUBY_API_KEY;
const port = Number(process.env.PORT ?? 8787);
const appOrigins = (process.env.APP_ORIGINS ?? 'http://localhost:5181').split(',');
const playable = new Set((process.env.PLAYABLE_ASSET_IDS ?? '').split(',').filter(Boolean));
if (!apiKey) {
  console.error('SLUBY_API_KEY is required');
  process.exit(1);
}

// GET /api/v1/playback/:id/signed, what client.playback.getSignedUrl calls
const SIGNED_PATH = /^\/api\/v1\/playback\/([^/]+)\/signed$/;

/**
 * Whether this viewer may watch the asset. A real app checks its own session
 * here (is the user signed in, did they buy this video); the example allows a
 * fixed list.
 *
 * @param {import('node:http').IncomingMessage} _req
 * @param {string} assetId
 */
function canWatch(_req, assetId) {
  return playable.has(assetId);
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && appOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = req.method === 'GET' ? SIGNED_PATH.exec(url.pathname) : null;
  if (!match || !canWatch(req, decodeURIComponent(match[1]))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // forward only the lifetime parameter, the rest of the query is not ours
  const expiresIn = url.searchParams.get('expires_in');
  const query = expiresIn ? `?expires_in=${encodeURIComponent(expiresIn)}` : '';
  try {
    const upstream = await fetch(`${slubyUrl}${url.pathname}${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    // pass the answer through unchanged: the browser sdk parses sluby's own json
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await upstream.text());
  } catch (err) {
    console.error('sluby request failed', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Sluby' }));
  }
}).listen(port, () => {
  console.log(`signing server on http://localhost:${port}, forwarding to ${slubyUrl}`);
});

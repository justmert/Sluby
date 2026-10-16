// Node side of the browser tests: a vite plugin that serves the checked-in HLS
// fixture the way the Sluby delivery gateway does. Every manifest, playlist,
// and data file is an object addressed as /v1/objects/{id}, playlists are
// rewritten to point at those object URLs (as backend/src/transcode/
// manifest-rewriter.ts does), and byte ranges are answered with 206.
//
// Side endpoints under /__fixture/ let a test read the catalog, inspect which
// object requests reached the gateway, inject failures, sign urls, and fetch
// raw object bytes for the fake Sia session (which stands in for the Sia
// network, so it must not show up as a gateway request).
//
// An object asked for with `expires` and `sig` is checked like a private one:
// a missing, bad or expired signature is refused with 403, and a manifest is
// served with every object url in it signed until the same expiry, as the
// backend's signManifestObjectUrls does. Plain urls stay unchecked.
//
// The public share map is gated like the backend's GET /v1/share/:id: the
// gated id (GATED_SHARE_ID) answers only with a valid, unexpired `expires` and
// `sig` over the master object, and its map never outlives that signature.
//
// The suite runs in several browsers at once against this one server, so the
// logs and faults are kept per browser, told apart by the User-Agent header
// every request from a browser carries.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface FixtureRendition {
  name: string;
  playlistId: string;
  dataId: string;
  /** EXT-X-MAP byte range of the init segment. */
  init: { offset: number; length: number };
  /** EXT-X-BYTERANGE of each media segment, in order. */
  segments: Array<{ offset: number; length: number }>;
}

export interface FixtureCatalog {
  masterId: string;
  renditions: FixtureRendition[];
  sizes: Record<string, number>;
}

export interface GatewayRequest {
  id: string;
  method: string;
  range: string | null;
  status: number;
  /** the `expires` the url was signed until, or null for a plain url */
  expires: string | null;
}

/** A call to the public share map endpoint, /v1/share/:id. */
export interface ShareRequest {
  id: string;
  expires: string | null;
  sig: string | null;
  authorization: boolean;
  cookie: boolean;
}

/** A request that reached the REST API (/api/...); keyless playback must make none. */
export interface ApiRequest {
  method: string;
  path: string;
  authorization: boolean;
}

interface Fault {
  status: number;
  /** only fail ranged requests that start at or after this byte */
  fromByte: number;
}

interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

interface BrowserState {
  requests: GatewayRequest[];
  shareRequests: ShareRequest[];
  apiRequests: ApiRequest[];
  faults: Map<string, Fault>;
}

/** The share id that is gated, like a private asset or a signed playback id. */
export const GATED_SHARE_ID = 'pb_signedsignedsigned';

// the fixture's stand-in for the backend's signing secret
const SIGNING_SECRET = 'fixture-signing-secret';

/** The signature the backend puts on a url for an object: HMAC over `{id}:{expires}`. */
function signObject(objectId: string, expires: number): string {
  return createHmac('sha256', SIGNING_SECRET).update(`${objectId}:${expires}`).digest('hex');
}

function verifyObject(
  objectId: string,
  expires: string | null,
  sig: string | null,
): { ok: true; expires: number } | { ok: false; reason: string } {
  if (!expires || !sig) return { ok: false, reason: 'missing' };
  const at = Number(expires);
  if (!Number.isInteger(at)) return { ok: false, reason: 'malformed' };
  if (at <= Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  const want = Buffer.from(signObject(objectId, at), 'hex');
  const got = Buffer.from(sig, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, expires: at };
}

function objectId(bytes: Buffer, name: string): string {
  return createHash('sha256').update(name).update(bytes).digest('hex');
}

function parseByteRange(spec: string): { offset: number; length: number } {
  const [length, offset] = spec.split('@').map(Number);
  return { offset, length };
}

function loadFixture(dir: string): { catalog: FixtureCatalog; objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  const master = readFileSync(path.join(dir, 'master.m3u8'), 'utf8');
  const variantPaths = master
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const renditions: FixtureRendition[] = [];
  let rewrittenMaster = master;

  for (const variantPath of variantPaths) {
    const name = path.dirname(variantPath);
    const playlist = readFileSync(path.join(dir, variantPath), 'utf8');
    const mapMatch = /#EXT-X-MAP:URI="([^"]+)",BYTERANGE="([^"]+)"/.exec(playlist);
    if (!mapMatch) throw new Error(`fixture ${variantPath} has no EXT-X-MAP byte range`);
    const dataFile = mapMatch[1];
    const data = readFileSync(path.join(dir, name, dataFile));
    const dataId = objectId(data, `${name}/${dataFile}`);
    objects.set(dataId, { bytes: data, contentType: 'video/mp4' });

    const dataUrl = `/v1/objects/${dataId}`;
    const rewritten = playlist
      .replace(`#EXT-X-MAP:URI="${dataFile}"`, `#EXT-X-MAP:URI="${dataUrl}"`)
      .replace(new RegExp(`^${dataFile.replace('.', '\\.')}$`, 'gm'), dataUrl);
    const playlistBytes = Buffer.from(rewritten);
    const playlistId = objectId(playlistBytes, variantPath);
    objects.set(playlistId, { bytes: playlistBytes, contentType: 'application/vnd.apple.mpegurl' });
    rewrittenMaster = rewrittenMaster.replace(
      new RegExp(`^${variantPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'),
      `/v1/objects/${playlistId}`,
    );

    renditions.push({
      name,
      playlistId,
      dataId,
      init: parseByteRange(mapMatch[2]),
      segments: [...playlist.matchAll(/#EXT-X-BYTERANGE:(\S+)/g)].map((m) => parseByteRange(m[1])),
    });
  }

  const masterBytes = Buffer.from(rewrittenMaster);
  const masterId = objectId(masterBytes, 'master.m3u8');
  objects.set(masterId, { bytes: masterBytes, contentType: 'application/vnd.apple.mpegurl' });

  const sizes: Record<string, number> = {};
  for (const [id, obj] of objects) sizes[id] = obj.bytes.length;
  return { catalog: { masterId, renditions, sizes }, objects };
}

/** Parse a single `bytes=a-b` or `bytes=a-` range against an object size. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) return null;
  return { start, end };
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function hlsFixtureGateway(fixtureDir: string): Plugin {
  const { catalog, objects } = loadFixture(fixtureDir);
  const browsers = new Map<string, BrowserState>();
  const fresh = (): BrowserState => ({
    requests: [],
    shareRequests: [],
    apiRequests: [],
    faults: new Map(),
  });

  return {
    name: 'sluby-hls-fixture-gateway',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://fixture.local');
        const agent = req.headers['user-agent'] ?? '';
        let state = browsers.get(agent);
        if (!state) {
          state = fresh();
          browsers.set(agent, state);
        }
        const { requests, shareRequests, apiRequests, faults } = state;

        const objectMatch = /^\/v1\/objects\/([0-9a-f]+)$/.exec(url.pathname);
        if (objectMatch) {
          const id = objectMatch[1];
          const range = req.headers.range ?? null;
          const expires = url.searchParams.get('expires');
          const sig = url.searchParams.get('sig');
          const record = (status: number) =>
            requests.push({ id, method: req.method ?? '', range, status, expires });
          const obj = objects.get(id);
          res.setHeader('Cache-Control', 'no-store');
          if (!obj) {
            record(404);
            res.statusCode = 404;
            res.end('object not found');
            return;
          }
          let signedUntil: number | null = null;
          if (expires !== null || sig !== null) {
            const check = verifyObject(id, expires, sig);
            if (!check.ok) {
              record(403);
              res.statusCode = 403;
              res.end(`signature ${check.reason}`);
              return;
            }
            signedUntil = check.expires;
          }
          const fault = faults.get(id);
          const rangeStart = range ? (parseRange(range, obj.bytes.length)?.start ?? 0) : 0;
          if (fault && rangeStart >= fault.fromByte) {
            record(fault.status);
            res.statusCode = fault.status;
            res.end('injected failure');
            return;
          }
          res.setHeader('Content-Type', obj.contentType);
          res.setHeader('Accept-Ranges', 'bytes');
          if (range) {
            const r = parseRange(range, obj.bytes.length);
            if (!r) {
              record(416);
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${obj.bytes.length}`);
              res.end();
              return;
            }
            record(206);
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${r.start}-${r.end}/${obj.bytes.length}`);
            res.setHeader('Content-Length', String(r.end - r.start + 1));
            res.end(req.method === 'HEAD' ? undefined : obj.bytes.subarray(r.start, r.end + 1));
            return;
          }
          let body = obj.bytes;
          if (signedUntil !== null && obj.contentType === 'application/vnd.apple.mpegurl') {
            const at = signedUntil;
            body = Buffer.from(
              obj.bytes
                .toString('utf8')
                .replace(
                  /\/v1\/objects\/([0-9a-f]+)/g,
                  (url, child: string) => `${url}?expires=${at}&sig=${signObject(child, at)}`,
                ),
            );
          }
          record(200);
          res.statusCode = 200;
          res.setHeader('Content-Length', String(body.length));
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }

        // the public master url, served like /v1/objects/{master} and logged
        // as a gateway request so a keyless sia test can prove it never ran
        const streamMatch = /^\/v1\/stream\/([^/]+)\/master\.m3u8$/.exec(url.pathname);
        if (streamMatch) {
          const master = objects.get(catalog.masterId)!;
          requests.push({
            id: `stream:${decodeURIComponent(streamMatch[1])}`,
            method: req.method ?? '',
            range: req.headers.range ?? null,
            status: 200,
            expires: url.searchParams.get('expires'),
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', master.contentType);
          res.setHeader('Cache-Control', 'no-store');
          res.end(master.bytes);
          return;
        }

        // the backend's public share map: every object of the asset as a
        // sia:// url the fake sia network (fake-sia-storage.ts) resolves
        const shareMatch = /^\/v1\/share\/([^/]+)$/.exec(url.pathname);
        if (shareMatch) {
          const id = decodeURIComponent(shareMatch[1]);
          const expires = url.searchParams.get('expires');
          const sig = url.searchParams.get('sig');
          shareRequests.push({
            id,
            expires,
            sig,
            authorization: req.headers.authorization !== undefined,
            cookie: req.headers.cookie !== undefined,
          });
          let expiresAtMs = Date.now() + 3600_000;
          if (id === GATED_SHARE_ID) {
            const check = verifyObject(catalog.masterId, expires, sig);
            if (!check.ok) {
              sendJson(
                res,
                { error: 'This share map requires a valid signed URL', reason: check.reason },
                403,
              );
              return;
            }
            // the shares never outlive the signature that unlocked them
            expiresAtMs = Math.min(expiresAtMs, check.expires * 1000);
          }
          const expiresAt = new Date(expiresAtMs).toISOString();
          const shares: Record<string, string> = {};
          for (const id of objects.keys()) {
            shares[id] =
              `sia://fixture.local/objects/${id}/shared?sv=${Date.now()}#encryption_key=x`;
          }
          sendJson(res, { master_object_id: catalog.masterId, shares, expires_at: expiresAt });
          return;
        }

        if (url.pathname.startsWith('/api/')) {
          apiRequests.push({
            method: req.method ?? '',
            path: url.pathname,
            authorization: req.headers.authorization !== undefined,
          });
          res.statusCode = 404;
          res.end('no api here');
          return;
        }

        if (url.pathname === '/__fixture/share-requests') {
          sendJson(res, shareRequests);
          return;
        }

        if (url.pathname === '/__fixture/api-requests') {
          sendJson(res, apiRequests);
          return;
        }

        if (url.pathname === '/__fixture/catalog') {
          sendJson(res, catalog);
          return;
        }

        const rawMatch = /^\/__fixture\/sia\/([0-9a-f]+)$/.exec(url.pathname);
        if (rawMatch) {
          const obj = objects.get(rawMatch[1]);
          res.statusCode = obj ? 200 : 404;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(obj ? obj.bytes : undefined);
          return;
        }

        if (url.pathname === '/__fixture/requests') {
          sendJson(res, requests);
          return;
        }

        if (url.pathname === '/__fixture/reset' && req.method === 'POST') {
          browsers.set(agent, fresh());
          sendJson(res, { ok: true });
          return;
        }

        // a signed master url for the gated id, as a backend would mint it
        if (url.pathname === '/__fixture/sign') {
          const expiresIn = Number(url.searchParams.get('expires_in') ?? '3600');
          const at = Math.floor(Date.now() / 1000) + expiresIn;
          const query = `expires=${at}&sig=${signObject(catalog.masterId, at)}`;
          sendJson(res, {
            stream: `/v1/stream/${GATED_SHARE_ID}/master.m3u8?${query}`,
            object: `/v1/objects/${catalog.masterId}?type=manifest&${query}`,
            expires: at,
          });
          return;
        }

        if (url.pathname === '/__fixture/fault' && req.method === 'POST') {
          void readBody(req).then((body) => {
            const {
              id,
              status,
              fromByte = 0,
            } = JSON.parse(body) as {
              id: string;
              status: number;
              fromByte?: number;
            };
            faults.set(id, { status, fromByte });
            sendJson(res, { ok: true });
          }, next);
          return;
        }

        next();
      });
    },
  };
}

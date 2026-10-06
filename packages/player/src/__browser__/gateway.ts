// Node side of the browser tests: a vite plugin that serves the checked-in HLS
// fixture the way the Sluby delivery gateway does. Every manifest, playlist,
// and data file is an object addressed as /v1/objects/{id}, playlists are
// rewritten to point at those object URLs (as backend/src/transcode/
// manifest-rewriter.ts does), and byte ranges are answered with 206.
//
// Side endpoints under /__fixture/ let a test read the catalog, inspect which
// object requests reached the gateway, inject failures, and fetch raw object
// bytes for the fake Sia session (which stands in for the Sia network, so it
// must not show up as a gateway request).

import { createHash } from 'node:crypto';
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

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
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
  let requests: GatewayRequest[] = [];
  let faults = new Map<string, Fault>();

  return {
    name: 'sluby-hls-fixture-gateway',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://fixture.local');

        const objectMatch = /^\/v1\/objects\/([0-9a-f]+)$/.exec(url.pathname);
        if (objectMatch) {
          const id = objectMatch[1];
          const range = req.headers.range ?? null;
          const record = (status: number) =>
            requests.push({ id, method: req.method ?? '', range, status });
          const obj = objects.get(id);
          res.setHeader('Cache-Control', 'no-store');
          if (!obj) {
            record(404);
            res.statusCode = 404;
            res.end('object not found');
            return;
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
          record(200);
          res.statusCode = 200;
          res.setHeader('Content-Length', String(obj.bytes.length));
          res.end(req.method === 'HEAD' ? undefined : obj.bytes);
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
          requests = [];
          faults = new Map();
          sendJson(res, { ok: true });
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

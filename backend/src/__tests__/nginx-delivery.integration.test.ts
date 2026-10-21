import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import http from 'node:http';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';

// the real backend suite below streams objects from memory instead of the indexer
vi.mock('../storage/sia-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/sia-client.js')>()),
  openObject: vi.fn(),
}));

/**
 * End-to-end tests through the real nginx config the project ships
 * (`nginx/nginx.conf`, `nginx/conf.d/sia-aggregator.conf`, the
 * `nginx/templates` it renders at start and `nginx/limits.envsh`), run in the
 * same image the web container uses, in front of a second "origin"
 * container. They cover byte ranges (many ranges of one object URI come back
 * with their own bytes, whole objects are still cached) and the edge itself: redirects behind a published port,
 * security headers, compression, 404s, the per-client limits and following a
 * backend that comes back on a new address.
 *
 * Every container runs in a user-defined Docker network and talks by
 * container name, so there is no host-networking dependency (which is flaky on
 * CI runners). The origin is a plain nginx serving static files, which handles
 * Range requests natively, so it is a faithful stand-in for the object gateway.
 *
 * It runs wherever Docker is available (local dev and the CI ubuntu runner).
 * Without Docker it logs a loud warning and skips, so `npm test` still passes
 * on a machine without Docker; CI has Docker so the coverage is enforced there.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
// the web image's base (frontend/Dockerfile)
const NGINX_IMAGE = 'nginx:1-alpine';
const NET = 'sluby-itest-net';
const ORIGIN = 'sluby-itest-origin';
const PROXY = 'sluby-itest-proxy';
const LIMITED = 'sluby-itest-limited';
const SQUATTER = 'sluby-itest-squatter';

function docker(args: string[], opts: { capture?: boolean } = {}): string {
  const out = execFileSync('docker', args, {
    stdio: opts.capture ? ['ignore', 'pipe', 'ignore'] : 'ignore',
  });
  return out ? out.toString() : '';
}

function dockerAvailable(): boolean {
  try {
    docker(['info']);
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerAvailable();
if (!HAS_DOCKER) {
  // Loud, not silent: make it obvious this coverage did not run here.
  console.warn(
    '\n[nginx-delivery.integration] Docker not available: skipping the ' +
      'through-nginx tests. CI runs Docker so this is enforced there. ' +
      'Install/start Docker to run them locally.\n',
  );
}

/** 48 bytes where byte i holds value i, so a range is trivial to verify. */
const DATA = Buffer.from(Array.from({ length: 48 }, (_, i) => i));

const MASTER =
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n/v1/objects/variant\n';
const VARIANT =
  '#EXTM3U\n#EXT-X-MAP:URI="/v1/objects/data",BYTERANGE="16@0"\n' +
  '#EXTINF:1.0,\n#EXT-X-BYTERANGE:16@16\n/v1/objects/data\n#EXT-X-ENDLIST\n';

/** A hashed studio chunk, big and repetitive enough to compress. */
const CHUNK = 'export const x = "' + 'sluby '.repeat(2000) + '";\n';

/**
 * Minimal nginx that serves the origin files with native Range support. Like
 * the backend's delivery routes, it sends its own CORS headers; its /api/
 * routes send a nosniff header of their own and echo the client address the
 * proxy forwarded, and /v1/objects/slow trickles out so a download stays open.
 */
const ORIGIN_CONF = `events { worker_connections 128; }
http {
  server {
    listen 80;
    location /v1/objects/ {
      root /origin;
      add_header Access-Control-Allow-Origin * always;
      add_header Access-Control-Allow-Credentials true always;
      add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges" always;
    }
    # any name after master- is the master again, so a test can take a cache
    # key no other test has warmed
    location ~ ^/v1/objects/master-[a-z0-9-]+$ {
      root /origin;
      try_files /v1/objects/master =404;
      add_header Access-Control-Allow-Origin * always;
    }
    location ~ ^/v1/objects/slow {
      root /origin;
      try_files /v1/objects/slow =404;
      limit_rate 4k;
    }
    # share maps: the backend marks every map no-store, since each is a play
    # to count, and a gated one private, no-store
    location /v1/share/ {
      root /origin;
      default_type application/json;
      add_header Cache-Control "no-store" always;
      add_header Access-Control-Allow-Origin * always;
      add_header Access-Control-Allow-Credentials true always;
    }
    location /v1/share/gated {
      root /origin;
      default_type application/json;
      add_header Cache-Control "private, no-store" always;
      add_header Access-Control-Allow-Origin * always;
      add_header Access-Control-Allow-Credentials true always;
    }
    location = /v1/cache/stats {
      default_type application/json;
      return 200 '{"hits":0}';
    }
    location /v1/ {
      default_type application/json;
      return 404 '{"error":"Not found"}';
    }
    location /api/ {
      default_type text/plain;
      add_header X-Content-Type-Options nosniff;
      return 200 "xff=$http_x_forwarded_for real=$http_x_real_ip";
    }
    location = /health {
      default_type application/json;
      return 200 '{"status":"ok"}';
    }
    # echoes what the backend's metrics guard reads: the forwarded-for the
    # proxy set and the bearer token the client sent
    location = /metrics {
      default_type text/plain;
      return 200 "xff=$http_x_forwarded_for auth=$http_authorization";
    }
    # the watch page sends its own csp and nosniff, as the backend does
    location /watch/ {
      default_type text/html;
      add_header Content-Security-Policy "frame-ancestors *" always;
      add_header X-Content-Type-Options nosniff always;
      return 200 "<p>watch page</p>";
    }
  }
}
`;

const SHARE_MAP = JSON.stringify({
  master_object_id: 'master',
  shares: { master: 'sia://indexer/objects/master/shared?sv=1' },
  expires_at: '2030-01-01T00:00:00.000Z',
});

/** Write the origin file tree, the studio build stand-in and the configs. */
function writeFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sluby-nginx-'));
  const objects = join(dir, 'origin', 'v1', 'objects');
  mkdirSync(objects, { recursive: true });
  writeFileSync(join(objects, 'master'), MASTER);
  writeFileSync(join(objects, 'variant'), VARIANT);
  writeFileSync(join(objects, 'data'), DATA);
  writeFileSync(join(objects, 'slow'), Buffer.alloc(256 * 1024, 1));
  const share = join(dir, 'origin', 'v1', 'share');
  mkdirSync(share, { recursive: true });
  writeFileSync(join(share, 'public'), SHARE_MAP);
  writeFileSync(join(share, 'gated'), SHARE_MAP);
  writeFileSync(join(dir, 'origin.conf'), ORIGIN_CONF);

  // the studio build: the real index.html (so the csp hash is checked against
  // the real inline script), a favicon and one hashed chunk
  const html = join(dir, 'html');
  mkdirSync(join(html, 'assets'), { recursive: true });
  copyFileSync(join(repoRoot, 'frontend/index.html'), join(html, 'index.html'));
  writeFileSync(join(html, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(html, 'assets', 'index-abc123.js'), CHUNK);

  // The real proxy config, with its upstream pointed at the origin container.
  const siteConf = readFileSync(join(repoRoot, 'nginx/conf.d/sia-aggregator.conf'), 'utf8');
  if (!siteConf.includes('server backend:3000 resolve;')) {
    throw new Error('the upstream line this test rewrites has changed');
  }
  writeFileSync(
    join(dir, 'proxy.conf'),
    siteConf.replace('server backend:3000 resolve;', `server ${ORIGIN}:80 resolve;`),
  );
  copyFileSync(join(repoRoot, 'nginx/limits.envsh'), join(dir, 'limits.envsh'));
  chmodSync(join(dir, 'limits.envsh'), 0o755);
  return dir;
}

function cleanup(): void {
  for (const name of [PROXY, LIMITED, ORIGIN, SQUATTER]) {
    try {
      docker(['rm', '-f', name]);
    } catch {
      /* not running */
    }
  }
  try {
    docker(['network', 'rm', NET]);
  } catch {
    /* not present */
  }
}

function startOrigin(dir: string): void {
  docker([
    'run',
    '-d',
    '--name',
    ORIGIN,
    '--network',
    NET,
    '-v',
    `${dir}/origin.conf:/etc/nginx/nginx.conf:ro`,
    '-v',
    `${dir}/origin:/origin:ro`,
    NGINX_IMAGE,
  ]);
}

/** Run the shipped proxy config the way frontend/Dockerfile lays it out. */
function startProxy(dir: string, name: string, env: Record<string, string> = {}): string {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    NET,
    '-p',
    '127.0.0.1:0:80',
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-v',
    `${repoRoot}/nginx/nginx.conf:/etc/nginx/nginx.conf:ro`,
    '-v',
    `${dir}/proxy.conf:/etc/nginx/conf.d/default.conf:ro`,
    '-v',
    `${repoRoot}/nginx/templates:/etc/nginx/templates:ro`,
    '-v',
    `${dir}/limits.envsh:/docker-entrypoint.d/14-sluby-limits.envsh:ro`,
    '-v',
    `${dir}/html:/usr/share/nginx/html:ro`,
    NGINX_IMAGE,
  ]);
  const hostPort = docker(
    ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}', name],
    { capture: true },
  ).trim();
  return `http://127.0.0.1:${hostPort}`;
}

async function waitFor(container: string, url: string, timeoutMs = 25000): Promise<void> {
  // Per-request timeouts keep a stuck connection from hanging the whole hook.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let last: string;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) return;
      last = `status ${r.status}`;
    } catch (err) {
      last = String(err);
    }
    if (Date.now() > deadline) {
      let logs: string;
      try {
        logs = execFileSync('docker', ['logs', '--tail', '30', container], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString();
      } catch (err) {
        logs = String(err);
      }
      throw new Error(`${url} did not become ready (${last}); ${container} logs:\n${logs}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function fetchThroughNginx(
  base: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; buf: Buffer; headers: Headers }> {
  const r = await fetch(base + path, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(4000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, headers: r.headers };
}

/**
 * Raw response headers, one entry per header line. fetch joins repeats with
 * ", ", which hides a header sent twice, and it always decompresses.
 */
function rawGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: string[]; body: Buffer }> {
  return new Promise((done, fail) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        done({ status: res.statusCode ?? 0, raw: res.rawHeaders, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', fail);
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });
}

function headerValues(raw: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].toLowerCase() === name.toLowerCase()) out.push(raw[i + 1]);
  }
  return out;
}

describe.skipIf(!HAS_DOCKER)('the web proxy (nginx) in front of the backend', () => {
  let base: string;
  let limited: string;
  let dir: string;

  beforeAll(async () => {
    cleanup();
    docker(['pull', NGINX_IMAGE]);
    docker(['network', 'create', NET]);

    dir = writeFixtures();
    startOrigin(dir);
    base = startProxy(dir, PROXY);
    // a second proxy with tight limits, so they can be reached in a test
    limited = startProxy(dir, LIMITED, {
      WEB_DELIVERY_RATE: '60r/m',
      WEB_DELIVERY_BURST: '3',
      WEB_DELIVERY_CONN: '2',
      WEB_AUTH_RATE: '60r/m',
      WEB_AUTH_BURST: '2',
    });

    await waitFor(PROXY, `${base}/v1/objects/master`);
    await waitFor(LIMITED, `${limited}/health`);
  }, 120000);

  afterAll(() => {
    cleanup();
  });

  describe('delivery', () => {
    it('serves the master and variant manifests', async () => {
      const master = await fetchThroughNginx(base, '/v1/objects/master?type=manifest');
      expect(master.status).toBe(200);
      expect(master.buf.toString()).toContain('/v1/objects/variant');

      const variant = await fetchThroughNginx(base, '/v1/objects/variant?type=manifest');
      expect(variant.status).toBe(200);
      expect(variant.buf.toString()).toContain('/v1/objects/data');
    });

    it('returns the correct bytes for the init range and multiple media ranges', async () => {
      // The whole point: every range of the SAME object URI must return its own
      // bytes. Under the old range-independent 206 cache key, the 2nd and 3rd
      // ranges came back as the first range's cached bytes.
      const ranges: Array<[number, number]> = [
        [0, 15], // init segment
        [16, 31], // media range 1
        [32, 47], // media range 2
      ];
      for (const [start, end] of ranges) {
        const r = await fetchThroughNginx(base, '/v1/objects/data', {
          Range: `bytes=${start}-${end}`,
        });
        expect(r.status).toBe(206);
        expect(r.buf.length).toBe(end - start + 1);
        expect(r.buf[0]).toBe(start);
        expect(r.buf[r.buf.length - 1]).toBe(end);
        // Ranged reads bypass the proxy cache.
        expect(r.headers.get('x-cache-status')).toBe('BYPASS');
      }
    });

    it('sends a single Access-Control-Allow-Origin, cached or not', async () => {
      // fetch joins repeated headers with ", ", and a browser rejects "*, *"
      const path = '/v1/objects/master-cors';
      const first = await fetchThroughNginx(base, path, { Origin: 'http://example.test' });
      const cached = await fetchThroughNginx(base, path, { Origin: 'http://example.test' });
      const ranged = await fetchThroughNginx(base, '/v1/objects/data', {
        Origin: 'http://example.test',
        Range: 'bytes=0-15',
      });
      expect(cached.headers.get('x-cache-status')).toBe('HIT');
      for (const r of [first, cached, ranged]) {
        expect(r.headers.get('access-control-allow-origin')).toBe('*');
        expect(r.headers.get('access-control-allow-credentials')).toBeNull();
        expect(r.headers.get('access-control-expose-headers')).toBe(
          'Content-Length, Content-Range, Accept-Ranges, ETag',
        );
      }
    });

    it('still caches whole-object responses (MISS then HIT)', async () => {
      // Use a fresh cache key the readiness probe never warmed, so the first
      // request is a genuine MISS.
      const path = '/v1/objects/master-cachetest';
      const first = await fetchThroughNginx(base, path);
      const second = await fetchThroughNginx(base, path);
      expect(first.headers.get('x-cache-status')).toBe('MISS');
      expect(second.headers.get('x-cache-status')).toBe('HIT');
    });

    it('keys the cache on the path and the type hint only, so junk queries cannot force misses', async () => {
      const first = await fetchThroughNginx(base, '/v1/objects/master-qs');
      const junk = await fetchThroughNginx(base, '/v1/objects/master-qs?x=2&y=3');
      const typed = await fetchThroughNginx(base, '/v1/objects/master-qs?type=manifest');
      expect(first.headers.get('x-cache-status')).toBe('MISS');
      expect(junk.headers.get('x-cache-status')).toBe('HIT');
      // the hint changes the content type, so it is its own entry
      expect(typed.headers.get('x-cache-status')).toBe('MISS');
    });

    it('never answers a signed request from the cache', async () => {
      await fetchThroughNginx(base, '/v1/objects/master-signed');
      const signed = await fetchThroughNginx(base, '/v1/objects/master-signed?expires=1&sig=ab');
      expect(signed.headers.get('x-cache-status')).toBe('BYPASS');
    });

    it('proxies share maps with one set of cors headers, keeping none', async () => {
      const origin = { Origin: 'http://example.test' };
      const first = await fetchThroughNginx(base, '/v1/share/public', origin);
      const second = await fetchThroughNginx(base, '/v1/share/public', origin);
      expect(first.status).toBe(200);
      expect(JSON.parse(first.buf.toString()).master_object_id).toBe('master');
      expect(first.headers.get('x-cache-status')).toBe('MISS');
      // every load reaches the backend, which counts it as a play
      expect(second.headers.get('x-cache-status')).toBe('MISS');

      const gatedFirst = await fetchThroughNginx(base, '/v1/share/gated?expires=1&sig=a', origin);
      const gatedSecond = await fetchThroughNginx(base, '/v1/share/gated?expires=1&sig=a', origin);
      expect(gatedFirst.status).toBe(200);
      expect(gatedSecond.headers.get('x-cache-status')).not.toBe('HIT');
      expect(gatedSecond.headers.get('cache-control')).toBe('private, no-store');

      for (const r of [first, second, gatedFirst, gatedSecond]) {
        expect(r.headers.get('access-control-allow-origin')).toBe('*');
        expect(r.headers.get('access-control-allow-credentials')).toBeNull();
      }

      const preflight = await fetch(`${base}/v1/share/public`, {
        method: 'OPTIONS',
        headers: { ...origin, 'Access-Control-Request-Method': 'GET' },
        signal: AbortSignal.timeout(4000),
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('proxies the rest of /v1/ to the backend instead of the studio', async () => {
      const stats = await fetchThroughNginx(base, '/v1/cache/stats');
      expect(stats.status).toBe(200);
      expect(JSON.parse(stats.buf.toString())).toEqual({ hits: 0 });
      const unknown = await fetchThroughNginx(base, '/v1/nope');
      expect(unknown.status).toBe(404);
      expect(unknown.headers.get('content-type')).toMatch(/json/);
    });
  });

  describe('studio and redirects', () => {
    it('redirects / to a path, so a published port other than 80 survives', async () => {
      const r = await fetchThroughNginx(base, '/');
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('/studio');
      // the same behind an https proxy that forwards to port 80
      const proxied = await fetchThroughNginx(base, '/', { 'X-Forwarded-Proto': 'https' });
      expect(proxied.headers.get('location')).toBe('/studio');
    });

    it('serves the app on studio routes', async () => {
      for (const path of ['/studio', '/studio/assets/9a1c', '/studio/settings?tab=keys']) {
        const r = await fetchThroughNginx(base, path);
        expect(r.status).toBe(200);
        expect(r.buf.toString()).toContain('<div id="root">');
      }
    });

    it('answers a plain 404 for missing files, not the app', async () => {
      for (const path of ['/studio/assets/nope.js', '/assets/nope.js', '/nope.js']) {
        const r = await fetchThroughNginx(base, path);
        expect(r.status, path).toBe(404);
        expect(r.buf.toString(), path).not.toContain('<div id="root">');
      }
    });

    it('answers unknown paths with a 404 that is the studio, so its not-found page shows', async () => {
      for (const path of ['/nope', '/some/deep/path']) {
        const r = await rawGet(base + path);
        expect(r.status, path).toBe(404);
        expect(r.body.toString(), path).toContain('<div id="root">');
        // the same headers as the app itself
        expect(headerValues(r.raw, 'content-security-policy'), path).toHaveLength(1);
        expect(headerValues(r.raw, 'cache-control'), path).toEqual(['no-store']);
        expect(headerValues(r.raw, 'x-frame-options'), path).toEqual(['DENY']);
      }
      // the favicon at the root still loads
      expect((await fetchThroughNginx(base, '/favicon.svg')).status).toBe(200);
    });

    it('sends the security headers once each on the app, with a csp that matches the theme script', async () => {
      const html = readFileSync(join(repoRoot, 'frontend/index.html'), 'utf8');
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(inline).toHaveLength(1);
      const hash = createHash('sha256').update(inline[0]).digest('base64');

      for (const path of ['/studio', '/studio/upload']) {
        const r = await rawGet(base + path);
        expect(headerValues(r.raw, 'x-content-type-options')).toEqual(['nosniff']);
        expect(headerValues(r.raw, 'x-frame-options')).toEqual(['DENY']);
        expect(headerValues(r.raw, 'referrer-policy')).toEqual(['strict-origin-when-cross-origin']);
        // no-store keeps the signed-in studio out of the back/forward cache
        expect(headerValues(r.raw, 'cache-control')).toEqual(['no-store']);
        const csp = headerValues(r.raw, 'content-security-policy');
        expect(csp).toHaveLength(1);
        expect(csp[0]).toContain(`'sha256-${hash}'`);
        expect(csp[0]).toContain("frame-ancestors 'none'");
        expect(csp[0]).toContain("'wasm-unsafe-eval'");
        expect(headerValues(r.raw, 'server')).toEqual(['nginx']);
        // tls is the outer proxy's job; plain http must not pin anything
        expect(headerValues(r.raw, 'strict-transport-security')).toEqual([]);
      }
    });

    it('serves hashed chunks with one long cache header, compressed', async () => {
      const r = await rawGet(`${base}/assets/index-abc123.js`, { 'Accept-Encoding': 'gzip' });
      expect(r.status).toBe(200);
      expect(headerValues(r.raw, 'cache-control')).toEqual(['public, max-age=31536000, immutable']);
      expect(headerValues(r.raw, 'expires')).toEqual([]);
      expect(headerValues(r.raw, 'x-content-type-options')).toEqual(['nosniff']);
      expect(headerValues(r.raw, 'content-encoding')).toEqual(['gzip']);
      expect(gunzipSync(r.body).toString()).toBe(CHUNK);
    });

    it('keeps one copy of the security headers on proxied api responses', async () => {
      const r = await rawGet(`${base}/api/v1/whatever`);
      expect(headerValues(r.raw, 'x-content-type-options')).toEqual(['nosniff']);
      expect(headerValues(r.raw, 'x-frame-options')).toEqual(['DENY']);
      expect(headerValues(r.raw, 'content-security-policy')).toEqual([]);
    });

    it('sends the watch page to the backend, frameable, with one copy of its headers', async () => {
      const r = await rawGet(`${base}/watch/pb_x`);
      expect(r.body.toString()).toBe('<p>watch page</p>');
      expect(headerValues(r.raw, 'x-frame-options')).toEqual([]);
      expect(headerValues(r.raw, 'x-content-type-options')).toEqual(['nosniff']);
      expect(headerValues(r.raw, 'content-security-policy')).toEqual(['frame-ancestors *']);
    });

    it('leaves the delivery responses to their own headers', async () => {
      const r = await rawGet(`${base}/v1/objects/master?hdr=1`);
      expect(headerValues(r.raw, 'x-content-type-options')).toEqual([]);
      expect(headerValues(r.raw, 'x-frame-options')).toEqual([]);
      expect(headerValues(r.raw, 'access-control-allow-origin')).toEqual(['*']);
    });
  });

  describe('metrics', () => {
    it('proxies /metrics to the backend with the bearer token and a forwarded-for it set', async () => {
      const r = await rawGet(`${base}/metrics`, { Authorization: 'Bearer scrape' });
      expect(r.status).toBe(200);
      // the client sent no X-Forwarded-For; nginx sets one anyway, which is
      // how the backend tells a request from outside
      expect(r.body.toString()).toMatch(/^xff=\S+ auth=Bearer scrape$/);
      // never kept, and the security headers once each
      expect(headerValues(r.raw, 'x-cache-status')).toEqual([]);
      expect(headerValues(r.raw, 'x-content-type-options')).toEqual(['nosniff']);
      expect(headerValues(r.raw, 'x-frame-options')).toEqual(['DENY']);
      expect(headerValues(r.raw, 'content-security-policy')).toEqual([]);
    });

    it('replaces what a client puts in X-Forwarded-For, so it cannot pass for the internal network', async () => {
      const chained = await rawGet(`${base}/metrics`, {
        'X-Forwarded-For': '6.6.6.6, 198.51.100.7',
      });
      expect(chained.body.toString()).toBe('xff=198.51.100.7 auth=');
      const empty = await rawGet(`${base}/metrics`, { 'X-Forwarded-For': '' });
      expect(empty.body.toString()).toMatch(/^xff=\S+ auth=$/);
    });

    it('limits /metrics per client like sign-in', async () => {
      const client = { 'X-Forwarded-For': '203.0.113.6' };
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await fetchThroughNginx(limited, '/metrics', client)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
    });
  });

  describe('logs', () => {
    it('keeps link tokens, signatures and sign-in codes out of its logs', async () => {
      await fetchThroughNginx(base, '/studio/join/SECRETJOINTOKEN');
      await fetchThroughNginx(base, '/api/v1/auth/invites/SECRETINVITETOKEN/accept');
      await fetchThroughNginx(base, '/v1/objects/master?expires=1&sig=SECRETSIGNATURE');
      await fetchThroughNginx(
        base,
        '/api/v1/auth/github/callback?code=SECRETCODE&state=SECRETSTATE',
      );
      await fetchThroughNginx(base, '/health', {
        Referer: 'https://video.example.com/studio/reset/SECRETRESETTOKEN?x=SECRETQUERY',
      });
      // nginx writes the access log to stdout and the error log to stderr
      const logs = execFileSync('docker', ['logs', PROXY], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      expect(logs).toContain('/studio/join/[redacted]');
      expect(logs).toContain('/api/v1/auth/invites/[redacted]/accept');
      expect(logs).toContain('/v1/objects/master?[redacted]');
      expect(logs).toContain('/api/v1/auth/github/callback?[redacted]');
      expect(logs).toContain('"https://video.example.com/studio/reset/[redacted]"');
      expect(logs).not.toContain('SECRET');
    });
  });

  describe('client address', () => {
    it('passes on the client a trusted proxy in front reported, alone', async () => {
      // the test runner reaches the container from a private docker address,
      // as caddy does in production
      const r = await rawGet(`${base}/api/v1/echo`, { 'X-Forwarded-For': '198.51.100.7' });
      expect(r.body.toString()).toBe('xff=198.51.100.7 real=198.51.100.7');
      // a client-supplied hop in front of that is dropped
      const chained = await rawGet(`${base}/api/v1/echo`, {
        'X-Forwarded-For': '6.6.6.6, 198.51.100.7',
      });
      expect(chained.body.toString()).toBe('xff=198.51.100.7 real=198.51.100.7');
    });
  });

  describe('per-client limits', () => {
    it('answers 429 with Retry-After past the delivery burst, per client', async () => {
      const client = { 'X-Forwarded-For': '203.0.113.1' };
      const statuses: number[] = [];
      let last: Awaited<ReturnType<typeof fetchThroughNginx>> | undefined;
      for (let i = 0; i < 6; i++) {
        last = await fetchThroughNginx(limited, '/v1/objects/master?limit=1', client);
        statuses.push(last.status);
      }
      // one at the rate plus a burst of three
      expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
      expect(statuses.slice(4)).toEqual([429, 429]);
      expect(last!.headers.get('retry-after')).toBe('1');
      expect(last!.headers.get('access-control-allow-origin')).toBe('*');
      expect(JSON.parse(last!.buf.toString())).toEqual({
        error: 'Too many requests. Try again in a few seconds.',
      });

      const neighbour = await fetchThroughNginx(limited, '/v1/objects/master?limit=1', {
        'X-Forwarded-For': '203.0.113.2',
      });
      expect(neighbour.status).toBe(200);
    });

    it('limits sign-in routes, and not the rest of the api or the studio', async () => {
      const client = { 'X-Forwarded-For': '203.0.113.3' };
      const auth: number[] = [];
      for (let i = 0; i < 5; i++) {
        auth.push((await fetchThroughNginx(limited, '/api/v1/auth/me', client)).status);
      }
      expect(auth.slice(0, 3)).toEqual([200, 200, 200]);
      expect(auth.slice(3)).toEqual([429, 429]);

      for (let i = 0; i < 20; i++) {
        expect((await fetchThroughNginx(limited, '/api/v1/assets', client)).status).toBe(200);
        expect((await fetchThroughNginx(limited, '/assets/index-abc123.js', client)).status).toBe(
          200,
        );
        expect((await fetchThroughNginx(limited, '/studio', client)).status).toBe(200);
      }
    });

    it('caps open delivery downloads per client', async () => {
      const client = { 'X-Forwarded-For': '203.0.113.4' };
      const controller = new AbortController();
      // distinct cache keys, so the second does not wait on the first's cache lock
      const open = [0, 1].map((i) =>
        fetch(`${limited}/v1/objects/slow-${i}`, {
          headers: client,
          signal: controller.signal,
        }),
      );
      try {
        const started = await Promise.all(open);
        expect(started.map((r) => r.status)).toEqual([200, 200]);
        const third = await fetch(`${limited}/v1/objects/slow-third`, {
          headers: client,
          signal: AbortSignal.timeout(4000),
        });
        expect(third.status).toBe(429);
      } finally {
        controller.abort();
      }
    });

    it('does not throttle a page of thumbnails and a playback under the defaults', async () => {
      const client = { 'X-Forwarded-For': '203.0.113.5' };
      const page = await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          fetchThroughNginx(base, `/v1/objects/master-thumb-${i}`, client),
        ),
      );
      expect(page.every((r) => r.status === 200)).toBe(true);
      for (let i = 0; i < 40; i++) {
        const r = await fetchThroughNginx(base, '/v1/objects/data', {
          ...client,
          Range: `bytes=${i % 3}-15`,
        });
        expect(r.status).toBe(206);
      }
    });
  });

  describe('backend recreated on a new address', () => {
    it('follows the new address without a restart', async () => {
      expect((await fetchThroughNginx(base, '/health')).status).toBe(200);
      const oldIp = docker(
        [
          'inspect',
          '--format',
          '{{(index .NetworkSettings.Networks "' + NET + '").IPAddress}}',
          ORIGIN,
        ],
        { capture: true },
      ).trim();

      docker(['rm', '-f', ORIGIN]);
      // another container starts first, so the backend cannot get the old
      // address back even where docker hands out the lowest free one
      docker(['run', '-d', '--name', SQUATTER, '--network', NET, NGINX_IMAGE, 'sleep', '600']);
      startOrigin(dir);
      const newIp = docker(
        [
          'inspect',
          '--format',
          '{{(index .NetworkSettings.Networks "' + NET + '").IPAddress}}',
          ORIGIN,
        ],
        { capture: true },
      ).trim();
      expect(newIp).not.toBe(oldIp);

      // the resolver re-checks the name every 10s
      const deadline = Date.now() + 30000;
      let last = '';
      while (Date.now() < deadline) {
        try {
          last = String((await fetchThroughNginx(base, '/health')).status);
        } catch (err) {
          last = String((err as Error).cause ?? err);
        }
        if (last === '200') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(
        last,
        `proxy logs:\n${docker(['logs', '--tail', '20', PROXY], { capture: true })}`,
      ).toBe('200');
    }, 60000);
  });
});

/**
 * The same proxy config in front of the REAL backend app (createApp, the real
 * delivery gateway, access checks, signing and routes) on a real Postgres
 * database, so the cache directives are tested against what the backend
 * actually sends. Only the Sia indexer is a stand-in: objects stream from
 * memory. The app listens on the host; a small stream forwarder on the docker
 * network carries the proxy's traffic to it.
 *
 * It checks what an access change does to copies nginx already holds: once
 * the shared window has passed, an asset made private answers 403, a deleted
 * one 404, and one that only gained a signed playback id keeps playing.
 */
const FORWARDER = 'sluby-itest-backend';
const BACKEND_PROXY = 'sluby-itest-backend-proxy';

describe.skipIf(!HAS_DOCKER || !hasTestDatabase)(
  'the web proxy in front of the real backend: access changes reach cached copies',
  () => {
    let tdb: TestDatabase;
    let server: http.Server;
    let base: string;
    let closeDatabase: () => Promise<void>;
    let sharedWindowSec: number;
    let direct: string;
    const OWNER = 'workspace';
    const KEY = `sluby_${'f'.repeat(40)}`;
    const auth = { Authorization: `Bearer ${KEY}` };

    // three ready public assets, each with a master, a variant and a thumbnail
    const assets: Record<'tier' | 'handle' | 'deleted', { id: string; ids: string[] }> = {
      tier: { id: '', ids: [] },
      handle: { id: '', ids: [] },
      deleted: { id: '', ids: [] },
    };
    const bytes = new Map<string, Uint8Array>();

    function cleanupBackend(): void {
      for (const name of [BACKEND_PROXY, FORWARDER]) {
        try {
          docker(['rm', '-f', name]);
        } catch {
          /* not running */
        }
      }
    }

    beforeAll(async () => {
      process.env.PUBLIC_URL = 'http://sluby.test';
      process.env.AUTH_DISABLED = 'false';
      process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'sluby-nginx-up-'));
      tdb = await createTestDatabase();
      const appModule = await import('../app.js');
      const keys = await import('../db/queries/api-keys.js');
      const siaClient = await import('../storage/sia-client.js');
      ({ closeDatabase } = await import('../config/database.js'));
      sharedWindowSec = (await import('../delivery/aggregator.js')).SHARED_CACHE_SECONDS;

      await keys.createApiKey({
        name: 'itest',
        scopes: ['read', 'manage'],
        creatorAddress: OWNER,
        rawKey: KEY,
      });

      let n = 0;
      const oid = () => (++n).toString(16).padStart(64, 'c');
      for (const name of Object.keys(assets) as Array<keyof typeof assets>) {
        const [master, variant, thumb] = [oid(), oid(), oid()];
        bytes.set(variant, new TextEncoder().encode('#EXTM3U\n#EXT-X-ENDLIST\n'));
        bytes.set(
          master,
          new TextEncoder().encode(
            `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v1/objects/${variant}?type=playlist\n`,
          ),
        );
        bytes.set(thumb, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]));
        const [row] = await tdb.sql<{ id: string }[]>`
          insert into video_assets (title, creator_address, status, manifest_object_id,
            thumbnail_object_ids)
          values (${name}, ${OWNER}, 'ready', ${master}, ${[thumb]})
          returning id
        `;
        for (const [objectId, role] of [
          [master, 'master_manifest'],
          [variant, 'variant_playlist'],
          [thumb, 'thumbnail'],
        ] as const) {
          await tdb.sql`
            insert into artifacts (video_asset_id, role, object_id, byte_size)
            values (${row.id}, ${role}, ${objectId}, ${bytes.get(objectId)!.length})
          `;
        }
        assets[name] = { id: row.id, ids: [master, variant, thumb] };
      }

      // the indexer, from memory; both the current and the older download
      // functions, so this suite also runs against earlier versions
      const handle = async (id: string) => {
        const data = bytes.get(id);
        if (!data) throw new Error('app error: Api(404, "object not found")');
        return {
          id,
          size: data.length,
          read: (range?: { offset: number; length: number }) =>
            new ReadableStream<Uint8Array>({
              start(c) {
                const start = range?.offset ?? 0;
                c.enqueue(data.slice(start, range ? start + range.length : data.length));
                c.close();
              },
            }),
        };
      };
      vi.mocked(siaClient.openObject).mockImplementation(handle);

      // the metrics guard is set up when the app is made: this suite checks
      // the default, no token
      (await import('../config/env.js')).env.METRICS_TOKEN = undefined;

      const queue = { add: async () => undefined, getJobCounts: async () => ({}) };
      const { app } = appModule.createApp({
        logger: (await import('pino')).default({ level: 'silent' }),
        version: 'itest',
        startedAt: new Date(),
        queues: { transcode: queue, uploadSegments: queue, finalize: queue, deletion: queue },
        pingRedis: async () => {},
        webhookDispatcher: { dispatch: async () => {}, enqueue: async () => {} },
        triggerReconciliation: async () => ({ enqueued: false }),
      });
      server = http.createServer(app);
      await new Promise<void>((ok) => server.listen(0, '0.0.0.0', ok));
      const port = (server.address() as { port: number }).port;
      direct = `http://127.0.0.1:${port}`;

      cleanupBackend();
      try {
        docker(['network', 'create', NET]);
      } catch {
        /* the first suite made it */
      }
      const dir = mkdtempSync(join(tmpdir(), 'sluby-nginx-backend-'));
      writeFileSync(
        join(dir, 'forwarder.conf'),
        `events {}\nstream { server { listen 80; proxy_pass host.docker.internal:${port}; } }\n`,
      );
      docker([
        'run',
        '-d',
        '--name',
        FORWARDER,
        '--network',
        NET,
        '--add-host',
        'host.docker.internal:host-gateway',
        '-v',
        `${dir}/forwarder.conf:/etc/nginx/nginx.conf:ro`,
        NGINX_IMAGE,
      ]);
      const siteConf = readFileSync(join(repoRoot, 'nginx/conf.d/sia-aggregator.conf'), 'utf8');
      writeFileSync(
        join(dir, 'proxy.conf'),
        siteConf.replace('server backend:3000 resolve;', `server ${FORWARDER}:80 resolve;`),
      );
      copyFileSync(join(repoRoot, 'nginx/limits.envsh'), join(dir, 'limits.envsh'));
      chmodSync(join(dir, 'limits.envsh'), 0o755);
      mkdirSync(join(dir, 'html'));
      writeFileSync(join(dir, 'html', 'index.html'), '<div id="root"></div>');
      base = startProxy(dir, BACKEND_PROXY);
      await waitFor(BACKEND_PROXY, `${base}/v1/cache/stats`);
    }, 120_000);

    afterAll(async () => {
      cleanupBackend();
      await new Promise((ok) => server?.close(ok));
      await closeDatabase?.();
      await tdb?.drop();
    });

    const objectPath = (id: string) => `/v1/objects/${id}`;

    it('stops serving cached copies within the shared window after a tier change or a delete, and keeps playing next to a new signed handle', async () => {
      // fill nginx with every object of the three assets. A master playlist
      // is where a play starts, so it is never kept: each load reaches the
      // backend, which counts it
      for (const a of Object.values(assets)) {
        const [masterId, ...children] = a.ids;
        for (const id of children) {
          expect((await fetchThroughNginx(base, objectPath(id))).status).toBe(200);
          const again = await fetchThroughNginx(base, objectPath(id));
          expect(again.headers.get('x-cache-status')).toBe('HIT');
        }
        for (const path of [objectPath(masterId), `/v1/stream/${a.id}/master.m3u8`]) {
          expect((await fetchThroughNginx(base, path)).status).toBe(200);
          const again = await fetchThroughNginx(base, path);
          expect(again.status).toBe(200);
          expect(again.headers.get('x-cache-status')).toBe('MISS');
        }
      }
      const filledAt = Date.now();

      const patch = await fetch(`${base}/api/v1/assets/${assets.tier.id}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_tier: 'private' }),
      });
      expect(patch.status).toBe(200);
      const handle = await fetch(`${base}/api/v1/assets/${assets.handle.id}/playback-ids`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'signed' }),
      });
      expect(handle.status).toBe(201);
      const signedHandle = ((await handle.json()) as { playback_id: string }).playback_id;
      const del = await fetch(`${base}/api/v1/assets/${assets.deleted.id}`, {
        method: 'DELETE',
        headers: auth,
      });
      expect(del.status).toBe(200);

      // inside the window nginx may still hand out what it holds; this is
      // the bound the docs promise, not more
      const held = await fetchThroughNginx(base, objectPath(assets.tier.ids[2]));
      expect(held.headers.get('x-cache-status')).toBe('HIT');

      // past the shared window, nginx asks the backend again and passes on its answer
      const wait = filledAt + (sharedWindowSec + 2) * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      for (const id of assets.tier.ids) {
        const r = await fetchThroughNginx(base, objectPath(id));
        expect(r.status, `private ${id}`).toBe(403);
        expect(r.headers.get('cache-control')).toBe('no-store');
      }
      expect(
        (await fetchThroughNginx(base, `/v1/stream/${assets.tier.id}/master.m3u8`)).status,
      ).toBe(403);

      for (const id of assets.deleted.ids) {
        expect((await fetchThroughNginx(base, objectPath(id))).status, `deleted ${id}`).toBe(404);
      }
      expect(
        (await fetchThroughNginx(base, `/v1/stream/${assets.deleted.id}/master.m3u8`)).status,
      ).toBe(404);

      // a signed handle gates only its own entry: every object and the
      // asset's own master keep playing, revalidated rather than refetched
      for (const id of assets.handle.ids.slice(1)) {
        const r = await fetchThroughNginx(base, objectPath(id));
        expect(r.status, `handle ${id}`).toBe(200);
        expect(r.headers.get('x-cache-status')).toBe('REVALIDATED');
      }
      expect((await fetchThroughNginx(base, objectPath(assets.handle.ids[0]))).status).toBe(200);
      expect(
        (await fetchThroughNginx(base, `/v1/stream/${assets.handle.id}/master.m3u8`)).status,
      ).toBe(200);
      expect((await fetchThroughNginx(base, `/v1/stream/${signedHandle}/master.m3u8`)).status).toBe(
        403,
      );
    }, 180_000);

    it('keeps metrics without a token off the proxy, and serves them on the backend port', async () => {
      const proxied = await fetchThroughNginx(base, '/metrics');
      expect(proxied.status).toBe(404);
      expect(JSON.parse(proxied.buf.toString())).toEqual({
        error: 'Route GET /metrics not found',
      });
      // a client cannot clear the header nginx sets to get past the guard
      const spoofed = await fetchThroughNginx(base, '/metrics', { 'X-Forwarded-For': '' });
      expect(spoofed.status).toBe(404);

      // what a scraper on the internal network does: straight to the port
      const scrape = await fetch(`${direct}/metrics`, { signal: AbortSignal.timeout(4000) });
      expect(scrape.status).toBe(200);
      expect(await scrape.text()).toContain('# HELP');
    });

    it('takes the etag gzip weakened on the way out back in If-Match', async () => {
      const url = `${base}/api/v1/assets/${assets.handle.id}`;
      const got = await fetch(url, { headers: { ...auth, 'Accept-Encoding': 'gzip' } });
      expect(got.status).toBe(200);
      expect(got.headers.get('content-encoding')).toBe('gzip');
      const etag = got.headers.get('etag')!;
      expect(etag).toMatch(/^W\/"\d+"$/);

      const edit = await fetch(url, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ title: 'renamed through the proxy' }),
      });
      expect(edit.status).toBe(200);
      expect(((await edit.json()) as { title: string }).title).toBe('renamed through the proxy');

      // the weak tag of a version that has moved on still refuses the edit
      const stale = await fetch(url, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ title: 'too late' }),
      });
      expect(stale.status).toBe(412);
    });

    it('serves the signed playback of the private asset through the proxy, per request', async () => {
      const signed = await fetch(`${base}/api/v1/playback/${assets.tier.id}/signed`, {
        headers: auth,
      });
      expect(signed.status).toBe(200);
      const body = (await signed.json()) as { signed_url: string; poster_url: string };
      const path = new URL(body.signed_url).pathname + new URL(body.signed_url).search;
      const master = await fetchThroughNginx(base, path);
      expect(master.status).toBe(200);
      expect(master.headers.get('x-cache-status')).toBe('BYPASS');
      const child = /\/v1\/objects\/[0-9a-f]{64}\?[^\s]+/.exec(master.buf.toString())![0];
      expect((await fetchThroughNginx(base, child)).status).toBe(200);
      const poster = new URL(body.poster_url);
      expect((await fetchThroughNginx(base, poster.pathname + poster.search)).status).toBe(200);

      // revoked: the same links stop working at once
      const revoke = await fetch(`${base}/api/v1/playback/${assets.tier.id}/signed/revoke`, {
        method: 'POST',
        headers: auth,
      });
      expect(revoke.status).toBe(200);
      expect((await fetchThroughNginx(base, path)).status).toBe(403);
      expect((await fetchThroughNginx(base, child)).status).toBe(403);
    });
  },
);

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end delivery test through the REAL nginx config the project ships
 * (`nginx/nginx.conf` + `nginx/conf.d/sia-aggregator.conf`), run in a
 * container in front of a tiny upstream that mimics the aggregator's object
 * gateway. This is the test the milestone-2 review asked for: it proves that
 * many byte ranges of ONE object URI come back with their own bytes rather
 * than a wrongly-cached 206, and that whole-object responses are still cached.
 *
 * It runs wherever Docker is available (local dev and the CI ubuntu runner).
 * Without Docker it logs a loud warning and skips, so `npm test` still passes
 * on a machine without Docker; CI has Docker so the coverage is enforced there.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const NGINX_IMAGE = 'nginx:alpine';
const CONTAINER = 'sluby-nginx-itest';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
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
      'through-nginx range test. CI runs Docker so this is enforced there. ' +
      'Install/start Docker to run it locally.\n',
  );
}

/** 48 bytes where byte i holds value i, so a range is trivial to verify. */
const DATA = Buffer.from(Array.from({ length: 48 }, (_, i) => i));

const MASTER =
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n/v1/objects/variant\n';
const VARIANT =
  '#EXTM3U\n#EXT-X-MAP:URI="/v1/objects/data",BYTERANGE="16@0"\n' +
  '#EXTINF:1.0,\n#EXT-X-BYTERANGE:16@16\n/v1/objects/data\n#EXT-X-ENDLIST\n';

/** Upstream that models the object gateway for master/variant/data. */
function startUpstream(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/v1/objects/master')) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(MASTER);
      return;
    }
    if (url.startsWith('/v1/objects/variant')) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(VARIANT);
      return;
    }
    if (url.startsWith('/v1/objects/data')) {
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (m) {
          const start = Number(m[1]);
          const end = Number(m[2]);
          const slice = DATA.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${end}/${DATA.length}`,
            'Content-Length': String(slice.length),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(slice);
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(DATA.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(DATA);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((res) => {
    server.listen(0, '0.0.0.0', () => {
      res({ server, port: (server.address() as { port: number }).port });
    });
  });
}

/** Build a container-ready copy of the repo nginx config. */
function writeNginxConfig(upstreamPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'sluby-nginx-'));
  const mainConf = readFileSync(join(repoRoot, 'nginx/nginx.conf'), 'utf8');
  const siteConf = readFileSync(
    join(repoRoot, 'nginx/conf.d/sia-aggregator.conf'),
    'utf8',
  ).replace(
    'server backend:3000;',
    `server host.docker.internal:${upstreamPort};`,
  );
  writeFileSync(join(dir, 'nginx.conf'), mainConf);
  writeFileSync(join(dir, 'sia-aggregator.conf'), siteConf);
  return dir;
}

async function fetchThroughNginx(
  base: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; buf: Buffer; headers: Headers }> {
  const r = await fetch(base + path, { headers });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, headers: r.headers };
}

describe.skipIf(!HAS_DOCKER)('HLS delivery through nginx', () => {
  let upstream: Server;
  let base: string;
  let confDir: string;

  beforeAll(async () => {
    try {
      execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    } catch {
      /* not running */
    }
    execFileSync('docker', ['pull', NGINX_IMAGE], { stdio: 'ignore' });

    const started = await startUpstream();
    upstream = started.server;
    confDir = writeNginxConfig(started.port);

    // Mount the site config OVER the stock default.conf so ours is the only
    // server on port 80; otherwise the image's default server answers first
    // and serves its welcome root for /v1/objects/*.
    execFileSync('docker', [
      'run', '-d', '--name', CONTAINER,
      '--add-host=host.docker.internal:host-gateway',
      '-p', '127.0.0.1:0:80',
      '-v', `${confDir}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      '-v', `${confDir}/sia-aggregator.conf:/etc/nginx/conf.d/default.conf:ro`,
      NGINX_IMAGE,
    ]);

    const hostPort = execFileSync('docker', [
      'inspect', '--format',
      '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}',
      CONTAINER,
    ]).toString().trim();
    base = `http://127.0.0.1:${hostPort}`;

    // Wait for nginx + upstream to be ready.
    const deadline = Date.now() + 20000;
    for (;;) {
      try {
        const r = await fetch(`${base}/v1/objects/master`);
        if (r.status === 200) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('nginx did not become ready');
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 90000);

  afterAll(async () => {
    try {
      const logs = execFileSync('docker', ['logs', CONTAINER], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      void logs;
    } catch {
      /* ignore */
    }
    try {
      execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    await new Promise<void>((r) => upstream?.close(() => r()));
  });

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

  it('still caches whole-object responses (MISS then HIT)', async () => {
    // Use a fresh cache key the readiness probe never warmed, so the first
    // request is a genuine MISS.
    const path = '/v1/objects/master?cachetest=1';
    const first = await fetchThroughNginx(base, path);
    const second = await fetchThroughNginx(base, path);
    expect(first.headers.get('x-cache-status')).toBe('MISS');
    expect(second.headers.get('x-cache-status')).toBe('HIT');
  });
});

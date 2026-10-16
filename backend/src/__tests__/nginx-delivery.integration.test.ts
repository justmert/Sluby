import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end delivery test through the REAL nginx config the project ships
 * (`nginx/nginx.conf` + `nginx/conf.d/sia-aggregator.conf`), run in a
 * container in front of a second "origin" container. This is the test the
 * milestone-2 review asked for: it proves that many byte ranges of ONE object
 * URI come back with their own bytes rather than a wrongly-cached 206, and
 * that whole-object responses are still cached.
 *
 * Both nginx instances run in a user-defined Docker network and talk by
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
const NGINX_IMAGE = 'nginx:alpine';
const NET = 'sluby-itest-net';
const ORIGIN = 'sluby-itest-origin';
const PROXY = 'sluby-itest-proxy';

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

/**
 * Minimal nginx that serves the origin files with native Range support. Like
 * the backend's delivery routes, it sends its own CORS headers.
 */
const ORIGIN_CONF = `events { worker_connections 128; }
http {
  server {
    listen 80;
    location / {
      root /origin;
      add_header Access-Control-Allow-Origin * always;
      add_header Access-Control-Allow-Credentials true always;
      add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges" always;
    }
    # share maps: the backend marks a public map briefly cacheable and a gated
    # one private, no-store
    location /v1/share/ {
      root /origin;
      default_type application/json;
      add_header Cache-Control "public, max-age=30" always;
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
  }
}
`;

const SHARE_MAP = JSON.stringify({
  master_object_id: 'master',
  shares: { master: 'sia://indexer/objects/master/shared?sv=1' },
  expires_at: '2030-01-01T00:00:00.000Z',
});

/** Write the origin file tree and the container configs to a temp dir. */
function writeFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sluby-nginx-'));
  const objects = join(dir, 'origin', 'v1', 'objects');
  mkdirSync(objects, { recursive: true });
  writeFileSync(join(objects, 'master'), MASTER);
  writeFileSync(join(objects, 'variant'), VARIANT);
  writeFileSync(join(objects, 'data'), DATA);
  const share = join(dir, 'origin', 'v1', 'share');
  mkdirSync(share, { recursive: true });
  writeFileSync(join(share, 'public'), SHARE_MAP);
  writeFileSync(join(share, 'gated'), SHARE_MAP);
  writeFileSync(join(dir, 'origin.conf'), ORIGIN_CONF);

  // The real proxy config, with its upstream pointed at the origin container.
  const mainConf = readFileSync(join(repoRoot, 'nginx/nginx.conf'), 'utf8');
  const siteConf = readFileSync(join(repoRoot, 'nginx/conf.d/sia-aggregator.conf'), 'utf8').replace(
    'server backend:3000;',
    `server ${ORIGIN}:80;`,
  );
  writeFileSync(join(dir, 'nginx.conf'), mainConf);
  writeFileSync(join(dir, 'proxy.conf'), siteConf);
  return dir;
}

function cleanup(): void {
  for (const name of [PROXY, ORIGIN]) {
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

async function fetchThroughNginx(
  base: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; buf: Buffer; headers: Headers }> {
  const r = await fetch(base + path, {
    headers,
    signal: AbortSignal.timeout(4000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, headers: r.headers };
}

describe.skipIf(!HAS_DOCKER)('HLS delivery through nginx', () => {
  let base: string;

  beforeAll(async () => {
    cleanup();
    docker(['pull', NGINX_IMAGE]);
    docker(['network', 'create', NET]);

    const dir = writeFixtures();

    // Origin: static nginx, reachable by name on the network.
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

    // Proxy: the real repo config, mounted over the stock default.conf so it
    // is the only server, with a published port on the host.
    docker([
      'run',
      '-d',
      '--name',
      PROXY,
      '--network',
      NET,
      '-p',
      '127.0.0.1:0:80',
      '-v',
      `${dir}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      '-v',
      `${dir}/proxy.conf:/etc/nginx/conf.d/default.conf:ro`,
      NGINX_IMAGE,
    ]);

    const hostPort = docker(
      [
        'inspect',
        '--format',
        '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}',
        PROXY,
      ],
      { capture: true },
    ).trim();
    base = `http://127.0.0.1:${hostPort}`;

    // Wait for the proxy + origin to be ready. Per-request timeouts keep a
    // stuck connection from hanging the whole hook.
    const deadline = Date.now() + 25000;
    for (;;) {
      try {
        const r = await fetch(`${base}/v1/objects/master`, {
          signal: AbortSignal.timeout(2000),
        });
        if (r.status === 200) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('nginx did not become ready');
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 120000);

  afterAll(() => {
    cleanup();
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

  it('sends a single Access-Control-Allow-Origin, cached or not', async () => {
    // fetch joins repeated headers with ", ", and a browser rejects "*, *"
    const path = '/v1/objects/master?corstest=1';
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
        'Content-Length, Content-Range, Accept-Ranges',
      );
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

  it('proxies share maps with one set of cors headers, caching only public ones', async () => {
    const origin = { Origin: 'http://example.test' };
    const first = await fetchThroughNginx(base, '/v1/share/public', origin);
    const second = await fetchThroughNginx(base, '/v1/share/public', origin);
    expect(first.status).toBe(200);
    expect(JSON.parse(first.buf.toString()).master_object_id).toBe('master');
    expect(first.headers.get('x-cache-status')).toBe('MISS');
    expect(second.headers.get('x-cache-status')).toBe('HIT');

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
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  blockedReason,
  parseCidr,
  parseCidrList,
  postToReceiver,
  vetUrl,
  EgressError,
  type EgressPolicy,
  type ResolvedAddress,
} from '../webhooks/egress.js';
import { attemptDelivery } from '../webhooks/delivery.js';

describe('blockedReason', () => {
  it.each([
    // ipv4
    ['0.0.0.0', 'this-network'],
    ['0.1.2.3', 'this-network'],
    ['10.0.0.1', 'private (10'],
    ['10.255.255.255', 'private (10'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private (172.16'],
    ['172.31.255.255', 'private (172.16'],
    ['192.0.0.192', 'IETF protocol'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', '6to4 relay'],
    ['192.168.1.1', 'private (192.168'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved and broadcast'],
    // ipv6
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped link-local'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:0.0.0.0', 'IPv4-mapped this-network'],
    ['::127.0.0.1', 'IPv4-compatible'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 link-local'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['2002:7f00:1::1', '6to4 loopback'],
    ['2002:a9fe:a9fe::1', '6to4 link-local'],
    ['2002:c0a8:101::1', '6to4 private'],
    ['100::1', 'discard-only'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['3fff::1', 'documentation'],
    ['5f00::1', 'segment routing'],
    ['fc00::1', 'unique local'],
    ['fd00:ec2::254', 'cloud metadata'],
    ['fe80::1', 'link-local'],
    ['fe80::1%lo0', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['4000::1', 'not a global unicast'],
    ['not-an-ip', 'not an IP address'],
  ])('blocks %s (%s)', (ip, why) => {
    expect(blockedReason(ip)).toContain(why);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.215.14',
    '100.63.255.255',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.1',
    '169.253.255.255',
    '169.255.0.1',
    '192.169.0.1',
    '198.20.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
  ])('lets %s through', (ip) => {
    expect(blockedReason(ip)).toBeNull();
  });
});

describe('parseCidr', () => {
  it('parses networks and bare addresses, and rejects the rest', () => {
    expect(parseCidr('10.0.0.0/8')).toMatchObject({ family: 4, prefix: 8 });
    expect(parseCidr('10.1.2.3')).toMatchObject({ family: 4, prefix: 32 });
    expect(parseCidr('fd00::/8')).toMatchObject({ family: 6, prefix: 8 });
    expect(parseCidr('::1')).toMatchObject({ family: 6, prefix: 128 });
    for (const bad of ['10.0.0.0/33', 'fd00::/129', 'host.example', '10.0.0.0/x', '1.2.3/8', '']) {
      expect(parseCidr(bad), bad).toBeNull();
    }
    expect(() => parseCidrList('10.0.0.0/8, nope')).toThrow('nope');
    expect(parseCidrList(' 10.0.0.0/8 , ,fd00::/8 ')).toHaveLength(2);
  });
});

interface Local {
  server: Server;
  port: number;
  hits: string[];
}

const servers: Server[] = [];

async function listen(
  host: string,
  handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200);
    res.end('ok');
  },
): Promise<Local> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  servers.push(server);
  return { server, port: (server.address() as AddressInfo).port, hits };
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

const NO_EXEMPTIONS: EgressPolicy = { allowedNetworks: [] };
const LOOPBACK_V4: EgressPolicy = { allowedNetworks: parseCidrList('127.0.0.1/32') };

const post = (url: string, policy: EgressPolicy, timeoutMs = 2000) =>
  postToReceiver(url, { headers: {}, body: '{}', timeoutMs, policy });

async function refusal(promise: Promise<unknown>): Promise<EgressError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EgressError);
  return err as EgressError;
}

describe('postToReceiver against local servers', () => {
  it('reaches a public-looking receiver the operator exempted', async () => {
    const local = await listen('127.0.0.1');
    await expect(post(`http://127.0.0.1:${local.port}/hook`, LOOPBACK_V4)).resolves.toEqual({
      status: 200,
    });
    expect(local.hits).toEqual(['POST /hook']);
  });

  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['localhost by name', 'localhost'],
    ['the unspecified address', '0.0.0.0'],
    ['IPv4-mapped IPv6 loopback', '[::ffff:127.0.0.1]'],
    ['IPv6 loopback', '[::1]'],
  ])('never connects to %s', async (_label, host) => {
    // listen on every interface, so any connection that got through would land here
    const v4 = await listen('0.0.0.0');
    const err = await refusal(post(`http://${host}:${v4.port}/`, NO_EXEMPTIONS));
    expect(err.kind).toBe('blocked');
    expect(v4.hits).toEqual([]);
  });

  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.0.10',
    '100.64.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::ffff:169.254.169.254',
    'fd00:ec2::254',
    'fc00::5',
    'fe80::1',
    '::',
  ])('refuses a host name that resolves to %s, before any connection', async (address) => {
    const resolve = vi.fn(async (): Promise<ResolvedAddress[]> => [
      { address, family: address.includes(':') ? 6 : 4 },
    ]);
    const err = await refusal(
      post('http://receiver.test/hook', { allowedNetworks: [], resolve }, 500),
    );
    expect(err.kind).toBe('blocked');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('refuses a name with one private address among public ones', async () => {
    const resolve = async (): Promise<ResolvedAddress[]> => [
      { address: '93.184.215.14', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ];
    expect((await refusal(post('http://mixed.test/', { allowedNetworks: [], resolve }))).kind).toBe(
      'blocked',
    );
  });

  it('connects to the address it checked, not to a fresh dns answer (rebinding)', async () => {
    const good = await listen('127.0.0.1');
    const internal = await listen('::1');
    // first answer: the checked receiver; any later answer: an internal service.
    // node must not resolve again, so the second answer must never be used
    let calls = 0;
    const resolve = vi.fn(async (): Promise<ResolvedAddress[]> => {
      calls++;
      return calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '::1', family: 6 }];
    });
    // receiver.rebind.test is not in any real dns, so a lookup by node itself would fail
    const res = await post(`http://receiver.rebind.test:${good.port}/hook`, {
      allowedNetworks: parseCidrList('127.0.0.1/32'),
      resolve,
    });
    expect(res.status).toBe(200);
    expect(good.hits).toEqual(['POST /hook']);
    expect(internal.hits).toEqual([]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('does not follow a redirect to loopback, and reports the 3xx', async () => {
    const internal = await listen('::1');
    const outside = await listen('127.0.0.1', (_req, res) => {
      res.writeHead(307, { Location: `http://[::1]:${internal.port}/admin` });
      res.end();
    });
    const outcome = await attemptDelivery(
      { id: 'e', url: `http://127.0.0.1:${outside.port}/`, secret: 's', isActive: true },
      { endpointId: 'e', event: 'asset.ready', body: '{}' },
      { egress: LOOPBACK_V4 },
    );
    expect(outcome).toEqual({
      delivered: false,
      statusCode: 307,
      error: 'the receiver answered 307; redirects are not followed',
    });
    expect(outside.hits).toEqual(['POST /']);
    expect(internal.hits).toEqual([]);
  });

  it('judges a huge response on its status line without reading the body', async () => {
    let written = 0;
    const local = await listen('127.0.0.1', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const chunk = Buffer.alloc(1 << 20, 97);
      // would be 2 GB if anyone read it all
      const pump = () => {
        while (written < 2048 && res.write(chunk)) written++;
        if (written >= 2048) res.end();
        else res.once('drain', pump);
      };
      res.on('close', () => res.removeAllListeners('drain'));
      pump();
    });
    const rssBefore = process.memoryUsage().rss;
    const started = Date.now();
    await expect(post(`http://127.0.0.1:${local.port}/`, LOOPBACK_V4)).resolves.toEqual({
      status: 200,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    // far less than the body; well under the 2 GB the old code would buffer
    expect(process.memoryUsage().rss - rssBefore).toBeLessThan(200 * 1024 * 1024);
    expect(written).toBeLessThan(2048);
  });

  it('is not held by a receiver that trickles its body after the status line', async () => {
    const local = await listen('127.0.0.1', (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 100);
      res.on('close', () => clearInterval(timer));
    });
    const started = Date.now();
    await expect(post(`http://127.0.0.1:${local.port}/`, LOOPBACK_V4, 3000)).resolves.toEqual({
      status: 200,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('times out a receiver that never sends its status line', async () => {
    const local = await listen('127.0.0.1', () => {
      // holds the request open
    });
    const err = await refusal(post(`http://127.0.0.1:${local.port}/`, LOOPBACK_V4, 300));
    expect(err.kind).toBe('timeout');
  });

  it('times out a dns lookup that never answers', async () => {
    const resolve = () => new Promise<ResolvedAddress[]>(() => {});
    const err = await refusal(post('http://slow-dns.test/', { allowedNetworks: [], resolve }, 200));
    expect(err.kind).toBe('timeout');
  });
});

describe('vetUrl', () => {
  it('refuses anything but absolute http(s) urls', async () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://x/', '/relative']) {
      expect((await refusal(vetUrl(url, NO_EXEMPTIONS))).kind).toBe('invalid_url');
    }
  });

  it('reports a name that does not resolve', async () => {
    const resolve = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    expect(
      (await refusal(vetUrl('http://nope.test/', { allowedNetworks: [], resolve }))).kind,
    ).toBe('dns');
  });

  it('lets an exempted private network through, and only that network', async () => {
    const policy = (address: string): EgressPolicy => ({
      allowedNetworks: parseCidrList('10.20.0.0/16'),
      resolve: async () => [{ address, family: 4 }],
    });
    await expect(vetUrl('http://hooks.internal/', policy('10.20.3.4'))).resolves.toMatchObject({
      addresses: [{ address: '10.20.3.4', family: 4 }],
    });
    expect((await refusal(vetUrl('http://hooks.internal/', policy('10.21.0.1')))).kind).toBe(
      'blocked',
    );
  });
});

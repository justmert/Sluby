import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * Outbound requests to tenant-chosen URLs (webhook receivers). A tenant must
 * not be able to make the backend talk to anything inside the deployment: the
 * backend itself, postgres, redis, the indexd admin api, other compose
 * services, or a cloud metadata service. So:
 *
 * - the host is resolved once per request and every address it resolves to
 *   must be a public unicast address (see blockedReason);
 * - the connection goes to exactly the addresses that were checked (the
 *   socket's lookup is answered from them), so a DNS answer that changes
 *   between the check and the connect (rebinding) changes nothing;
 * - redirects are never followed, a 3xx is a failed attempt;
 * - the outcome is the status line; the body is never read or stored.
 *
 * Operators with receivers on their own network list those networks in
 * WEBHOOK_ALLOWED_NETWORKS.
 */

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

interface Cidr {
  family: 4 | 6;
  base: bigint;
  prefix: number;
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let a = ip.split('%')[0];
  const lastColon = a.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tail = a.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToBigInt(tail);
    if (v4 === null) return null;
    a = `${a.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parse `a.b.c.d/n`, `x:y::/n` or a bare address (a /32 or /128). */
export function parseCidr(text: string): Cidr | null {
  const [addr, len, ...extra] = text.trim().split('/');
  if (extra.length > 0 || !addr) return null;
  const family = net.isIP(addr);
  if (family === 0) return null;
  const bits = family === 4 ? 32 : 128;
  const prefix = len === undefined ? bits : Number(len);
  if (len !== undefined && !/^\d{1,3}$/.test(len)) return null;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const value = family === 4 ? ipv4ToBigInt(addr) : ipv6ToBigInt(addr);
  if (value === null) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { family: family as 4 | 6, base: value & mask, prefix };
}

/** Parse a comma-separated network list; throws on a bad entry so a typo fails boot. */
export function parseCidrList(raw: string): Cidr[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const cidr = parseCidr(s);
      if (!cidr) throw new Error(`not an IP address or network: ${s}`);
      return cidr;
    });
}

function contains(cidr: Cidr, family: 4 | 6, value: bigint): boolean {
  if (cidr.family !== family) return false;
  const bits = family === 4 ? 32 : 128;
  return value >> BigInt(bits - cidr.prefix) === cidr.base >> BigInt(bits - cidr.prefix);
}

const range = (text: string, why: string): [Cidr, string] => [parseCidr(text)!, why];

// IANA's special-purpose registries; nothing here is a webhook receiver on the
// public internet
const IPV4_BLOCKED: [Cidr, string][] = [
  range('0.0.0.0/8', 'this-network (0.0.0.0/8)'),
  range('10.0.0.0/8', 'private (10.0.0.0/8)'),
  range('100.64.0.0/10', 'shared address space, CGNAT (100.64.0.0/10)'),
  range('127.0.0.0/8', 'loopback (127.0.0.0/8)'),
  range('169.254.0.0/16', 'link-local and cloud metadata (169.254.0.0/16)'),
  range('172.16.0.0/12', 'private (172.16.0.0/12)'),
  range('192.0.0.0/24', 'IETF protocol assignments (192.0.0.0/24)'),
  range('192.0.2.0/24', 'documentation (192.0.2.0/24)'),
  range('192.88.99.0/24', '6to4 relay anycast (192.88.99.0/24)'),
  range('192.168.0.0/16', 'private (192.168.0.0/16)'),
  range('198.18.0.0/15', 'benchmarking (198.18.0.0/15)'),
  range('198.51.100.0/24', 'documentation (198.51.100.0/24)'),
  range('203.0.113.0/24', 'documentation (203.0.113.0/24)'),
  range('224.0.0.0/4', 'multicast (224.0.0.0/4)'),
  range('240.0.0.0/4', 'reserved and broadcast (240.0.0.0/4)'),
];

const IPV6_BLOCKED: [Cidr, string][] = [
  range('::/128', 'unspecified (::)'),
  range('::1/128', 'loopback (::1)'),
  range('::/96', 'IPv4-compatible (::/96)'),
  range('64:ff9b:1::/48', 'local-use NAT64 (64:ff9b:1::/48)'),
  range('100::/64', 'discard-only (100::/64)'),
  range('2001::/23', 'IETF protocol assignments, Teredo (2001::/23)'),
  range('2001:db8::/32', 'documentation (2001:db8::/32)'),
  range('3fff::/20', 'documentation (3fff::/20)'),
  range('5f00::/16', 'segment routing (5f00::/16)'),
  range('fc00::/7', 'unique local, incl. cloud metadata fd00:ec2::254 (fc00::/7)'),
  range('fe80::/10', 'link-local (fe80::/10)'),
  range('fec0::/10', 'site-local (fec0::/10)'),
  range('ff00::/8', 'multicast (ff00::/8)'),
];

const MAPPED = parseCidr('::ffff:0:0/96')!;
const NAT64 = parseCidr('64:ff9b::/96')!;
const SIX_TO_FOUR = parseCidr('2002::/16')!;
const GLOBAL_UNICAST = parseCidr('2000::/3')!;

function ipv4Reason(value: bigint): string | null {
  for (const [cidr, why] of IPV4_BLOCKED) if (contains(cidr, 4, value)) return why;
  return null;
}

/**
 * Why a resolved address must not be contacted, or null for a public unicast
 * address. IPv6 forms that carry an IPv4 address (mapped, NAT64, 6to4) are
 * judged by that IPv4 address, so `::ffff:127.0.0.1` is loopback.
 */
export function blockedReason(ip: string): string | null {
  const family = net.isIP(ip);
  if (family === 4) {
    const v = ipv4ToBigInt(ip);
    return v === null ? 'not an IP address' : ipv4Reason(v);
  }
  if (family !== 6) return 'not an IP address';
  const v = ipv6ToBigInt(ip);
  if (v === null) return 'not an IP address';

  const low32 = v & 0xffffffffn;
  if (contains(MAPPED, 6, v)) {
    const why = ipv4Reason(low32);
    return why && `IPv4-mapped ${why}`;
  }
  if (contains(NAT64, 6, v)) {
    const why = ipv4Reason(low32);
    return why && `NAT64 ${why}`;
  }
  if (contains(SIX_TO_FOUR, 6, v)) {
    const why = ipv4Reason((v >> 80n) & 0xffffffffn);
    if (why) return `6to4 ${why}`;
  }
  for (const [cidr, why] of IPV6_BLOCKED) if (contains(cidr, 6, v)) return why;
  if (!contains(GLOBAL_UNICAST, 6, v)) return 'not a global unicast address';
  return null;
}

// ---------------------------------------------------------------------------
// Policy and errors
// ---------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface EgressPolicy {
  /** Networks the operator allows despite blockedReason (WEBHOOK_ALLOWED_NETWORKS). */
  allowedNetworks: readonly Cidr[];
  /** Resolves a host name; the system resolver unless a test swaps it. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export type EgressFailure =
  'invalid_url' | 'dns' | 'blocked' | 'timeout' | 'connect' | 'tls' | 'request';

export class EgressError extends Error {
  constructor(
    readonly kind: EgressFailure,
    message: string,
  ) {
    super(message);
    this.name = 'EgressError';
  }
}

function isAllowedByOperator(ip: string, policy: EgressPolicy): boolean {
  const family = net.isIP(ip) as 4 | 6;
  const value = family === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  if (value === null) return false;
  return policy.allowedNetworks.some((c) => contains(c, family, value));
}

const systemResolve = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family as 4 | 6,
  }));

function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const fail = () => reject(new EgressError('timeout', 'timed out'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/**
 * Check a receiver URL: http(s), and every address its host resolves to is
 * public (or in WEBHOOK_ALLOWED_NETWORKS). Returns the parsed URL and the
 * checked addresses, which are the only ones a request may then connect to.
 */
export async function vetUrl(
  raw: string,
  policy: EgressPolicy,
  signal?: AbortSignal,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressError('invalid_url', 'not an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressError('invalid_url', 'only http and https URLs are allowed');
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');

  let addresses: ResolvedAddress[];
  const literal = net.isIP(host);
  if (literal !== 0) {
    addresses = [{ address: host, family: literal as 4 | 6 }];
  } else {
    try {
      addresses = await Promise.race([
        (policy.resolve ?? systemResolve)(host),
        rejectOnAbort(signal),
      ]);
    } catch (err) {
      if (err instanceof EgressError) throw err;
      throw new EgressError('dns', `the host name ${host} could not be resolved`);
    }
    if (addresses.length === 0) {
      throw new EgressError('dns', `the host name ${host} has no addresses`);
    }
  }

  for (const { address } of addresses) {
    const why = blockedReason(address);
    if (why && !isAllowedByOperator(address, policy)) {
      throw new EgressError(
        'blocked',
        `${host} resolves to a ${why} address, which webhooks may not reach`,
      );
    }
  }
  return { url, addresses };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/**
 * The socket's lookup, answered from the checked addresses only. Node passes
 * `all: true` when it races address families (autoSelectFamily, the default),
 * and expects a single address otherwise.
 */
function pinnedLookup(addresses: ResolvedAddress[]): net.LookupFunction {
  return (_hostname, options, callback) => {
    const cb = callback as (
      err: Error | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void;
    const wanted = (options as { family?: number }).family;
    const usable =
      wanted === 4 || wanted === 6 ? addresses.filter((a) => a.family === wanted) : addresses;
    if (usable.length === 0) {
      cb(new EgressError('dns', 'no checked address of the requested family'), '');
      return;
    }
    if ((options as { all?: boolean }).all) cb(null, usable);
    else cb(null, usable[0].address, usable[0].family);
  };
}

function classify(err: unknown, signal: AbortSignal): EgressError {
  if (err instanceof EgressError) return err;
  if (signal.aborted) return new EgressError('timeout', 'timed out');
  const code = (err as { code?: string }).code ?? '';
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code)) {
    return new EgressError('connect', `connection failed (${code})`);
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code.startsWith('ERR_SSL')) {
    return new EgressError('tls', `TLS failed (${code})`);
  }
  return new EgressError('request', code ? `request failed (${code})` : 'request failed');
}

/**
 * POST `body` to a vetted URL and return the response status. The body of the
 * response is discarded unread: a receiver streaming gigabytes or trickling
 * bytes costs nothing, and nothing it says is kept. Redirects are not
 * followed (node's http client never does); the caller treats a 3xx as a
 * failure, since its target was never checked.
 */
export async function postToReceiver(
  rawUrl: string,
  opts: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    policy: EgressPolicy;
  },
): Promise<{ status: number }> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const { url, addresses } = await vetUrl(rawUrl, opts.policy, signal);
  const client = url.protocol === 'https:' ? https : http;
  const payload = Buffer.from(opts.body, 'utf8');

  const status = await new Promise<number>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...opts.headers, 'Content-Length': String(payload.length) },
        lookup: pinnedLookup(addresses),
        agent: false,
        signal,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        // decided on the status line; the body is never read
        res.destroy();
        resolve(code);
      },
    );
    req.on('error', (err) => reject(classify(err, signal)));
    req.end(payload);
  }).catch((err: unknown) => {
    throw classify(err, signal);
  });
  return { status };
}

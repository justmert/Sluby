// @vitest-environment node
//
// SlubyClient's request and error handling against a real HTTP server on an
// ephemeral port, through the platform fetch: real status lines, real headers,
// real bodies. client.test.ts covers the same paths with a stubbed fetch.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SlubyClient } from './client.js';
import { SiaSession } from './sia-session.js';
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  SlubyError,
  TimeoutError,
} from './errors.js';

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type Responder = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let origin: string;
let seen: Seen[];
let respond: Responder;

const ASSET_ROW = {
  id: 'a1',
  title: 't',
  description: '',
  manifest_object_id: null,
  thumbnail_object_ids: [],
  duration_ms: 0,
  resolution: '',
  status: 'created',
  access_tier: 'public',
  creator_address: 'github:me',
  segment_count: 0,
  total_storage_bytes: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Responder {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
}

function text(status: number, body: string, reason?: string): Responder {
  return (_req, res) => {
    if (reason === undefined) res.writeHead(status, { 'Content-Type': 'text/plain' });
    else res.writeHead(status, reason, { 'Content-Type': 'text/plain' });
    res.end(body);
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  respond = json(200, ASSET_ROW);
});

async function failure(client: SlubyClient): Promise<SlubyError> {
  const err = await client.assets.get('a1').then(
    () => {
      throw new Error('expected the request to fail');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SlubyError);
  return err as SlubyError;
}

describe('construction and request shape', () => {
  it('keeps a path prefix on baseUrl and strips its trailing slashes', async () => {
    const client = new SlubyClient({ apiKey: 'k', baseUrl: `${origin}/sluby//` });
    await client.assets.get('a1');
    expect(seen.map((s) => s.url)).toEqual(['/sluby/api/v1/assets/a1']);
  });

  it('makes no request while constructing, with or without a sia viewer config', () => {
    const plain = new SlubyClient({ apiKey: 'k', baseUrl: origin });
    const withSia = new SlubyClient({
      apiKey: 'k',
      baseUrl: origin,
      sia: {
        indexerUrl: 'https://indexer.invalid',
        appId: '00'.repeat(32),
        appKey: '11'.repeat(32),
      },
    });
    expect(plain.sia).toBeUndefined();
    expect(withSia.sia).toBeInstanceOf(SiaSession);
    expect(seen).toEqual([]);
  });

  it('sends the bearer key and Accept, and keeps the caller method, headers, and body', async () => {
    const client = new SlubyClient({ apiKey: 'sluby_live', baseUrl: origin });
    const asset = await client.assets.update('a1', { title: 'renamed', accessTier: 'private' });

    expect(asset.id).toBe('a1');
    const [req] = seen;
    expect(req.method).toBe('PATCH');
    expect(req.headers.authorization).toBe('Bearer sluby_live');
    expect(req.headers.accept).toBe('application/json');
    expect(req.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({ title: 'renamed', access_tier: 'private' });
  });

  it('sends no Authorization header in cookie-session mode', async () => {
    const client = new SlubyClient({ baseUrl: origin, credentials: 'include' });
    await client.assets.get('a1');
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it('url-encodes ids into the path', async () => {
    const client = new SlubyClient({ apiKey: 'k', baseUrl: origin });
    await client.assets.get('a/b c');
    expect(seen[0].url).toBe('/api/v1/assets/a%2Fb%20c');
  });
});

describe('status to error class', () => {
  const client = () => new SlubyClient({ apiKey: 'k', baseUrl: origin });

  it.each([
    [400, SlubyError],
    [401, AuthenticationError],
    [403, AuthenticationError],
    [404, NotFoundError],
    [409, SlubyError],
    [410, SlubyError],
    [422, SlubyError],
    [429, RateLimitError],
    [500, SlubyError],
    [502, SlubyError],
    [503, SlubyError],
    [504, SlubyError],
  ])('%i maps to %o', async (status, ErrorClass) => {
    respond = json(status, { error: `status ${status}` });
    const err = await failure(client());

    expect(err.constructor).toBe(ErrorClass);
    expect(err.name).toBe(ErrorClass.name);
    expect(err.statusCode).toBe(status);
    expect(err.message).toBe(`status ${status}`);
    expect(err.responseBody).toBe(JSON.stringify({ error: `status ${status}` }));
    expect(err).not.toBeInstanceOf(TimeoutError);
  });

  it('reads Retry-After in seconds', async () => {
    respond = json(429, { error: 'Rate limit exceeded', retryAfter: 17 }, { 'Retry-After': '17' });
    const err = (await failure(client())) as RateLimitError;
    expect(err.retryAfter).toBe(17);
  });

  it('reads Retry-After given as an HTTP date', async () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    respond = json(429, { error: 'slow down' }, { 'Retry-After': at });
    const err = (await failure(client())) as RateLimitError;
    // the date has one-second resolution, so allow for the truncation
    expect(err.retryAfter).toBeGreaterThanOrEqual(88);
    expect(err.retryAfter).toBeLessThanOrEqual(90);
  });

  it('leaves retryAfter undefined when Retry-After is absent or unparseable', async () => {
    respond = json(429, { error: 'slow down' });
    expect(((await failure(client())) as RateLimitError).retryAfter).toBeUndefined();

    respond = json(429, { error: 'slow down' }, { 'Retry-After': 'soon' });
    expect(((await failure(client())) as RateLimitError).retryAfter).toBeUndefined();
  });

  it('treats a Retry-After date in the past as retry now', async () => {
    respond = json(429, { error: 'slow down' }, { 'Retry-After': new Date(0).toUTCString() });
    expect(((await failure(client())) as RateLimitError).retryAfter).toBe(0);
  });

  it('does not retry on its own: one failing call is one request', async () => {
    respond = json(503, { error: 'unavailable' });
    await failure(client());
    expect(seen).toHaveLength(1);
  });
});

describe('error message from the body', () => {
  const client = () => new SlubyClient({ apiKey: 'k', baseUrl: origin });

  it('prefers the JSON error field over message', async () => {
    respond = json(400, { error: 'from error', message: 'from message' });
    expect((await failure(client())).message).toBe('from error');
  });

  it('uses the JSON message field when there is no string error', async () => {
    respond = json(400, { error: { code: 'E_BAD' }, message: 'from message' });
    expect((await failure(client())).message).toBe('from message');
  });

  it('falls back to the status text for JSON without either field', async () => {
    respond = json(422, { detail: 'nope' });
    const err = await failure(client());
    expect(err.message).toBe('Unprocessable Entity');
    expect(err.responseBody).toBe('{"detail":"nope"}');
  });

  it('uses a short plain-text body as the message', async () => {
    respond = text(502, 'upstream connect error');
    expect((await failure(client())).message).toBe('upstream connect error');
  });

  it('uses the status text, not a long non-JSON body such as an HTML error page', async () => {
    const page = `<html><body>${'x'.repeat(300)}</body></html>`;
    respond = text(502, page);
    const err = await failure(client());
    expect(err.message).toBe('Bad Gateway');
    expect(err.responseBody).toBe(page);
  });

  it('uses the status text for an empty body', async () => {
    respond = text(500, '');
    const err = await failure(client());
    expect(err.message).toBe('Internal Server Error');
    expect(err.responseBody).toBe('');
  });

  it('falls back to a generic message with no body and no reason phrase', async () => {
    respond = text(500, '', '');
    expect((await failure(client())).message).toBe('Unknown API error');
  });
});

describe('network failures', () => {
  it('rejects with the platform fetch error when nothing is listening', async () => {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const client = new SlubyClient({ apiKey: 'k', baseUrl: `http://127.0.0.1:${deadPort}` });
    const err = await client.assets.get('a1').catch((e: unknown) => e);
    // not wrapped: callers tell transport failures from API errors by type
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(SlubyError);
  });

  it('rejects when the connection drops before a response', async () => {
    respond = (req) => req.socket.destroy();
    const client = new SlubyClient({ apiKey: 'k', baseUrl: origin });
    const err = await client.assets.get('a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(seen).toHaveLength(1);
  });
});

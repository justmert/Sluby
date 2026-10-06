import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  method: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * A real http server on a free local port that records every request and
 * answers through `respond`, which gets the 1-based request number.
 */
export async function startReceiver(respond: (n: number, res: ServerResponse) => void) {
  const requests: ReceivedRequest[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      for (const w of waiters.filter((w) => requests.length >= w.count)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
      respond(requests.length, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    /** Resolves once `count` requests have arrived. */
    waitFor: (count: number) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ count, resolve })),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function answer(res: ServerResponse, status: number, body = ''): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(body);
}

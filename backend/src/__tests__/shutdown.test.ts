import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { Writable } from 'node:stream';
import { createShutdown, closeServer } from '../shutdown.js';

function capture() {
  const messages: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      messages.push(JSON.parse(chunk.toString()).msg);
      cb();
    },
  });
  return { log: pino({ level: 'info' }, stream), messages };
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.closeAllConnections();
});

async function listening(handler: Parameters<typeof createServer>[1] = (_q, r) => r.end('ok')) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function exitPromise() {
  let resolve!: (code: number) => void;
  const done = new Promise<number>((r) => (resolve = r));
  return { exit: vi.fn((code: number) => resolve(code)), done };
}

const noop = () => Promise.resolve();

describe('createShutdown', () => {
  it('closes http, workers, queues and the database in order, then exits 0', async () => {
    const order: string[] = [];
    const { log, messages } = capture();
    const { exit, done } = exitPromise();
    const shutdown = createShutdown({
      server: await listening(),
      log,
      stopTimers: () => order.push('timers'),
      closeWorkers: async () => void order.push('workers'),
      closeQueues: async () => void order.push('queues'),
      closeDatabase: async () => void order.push('database'),
      exit,
    });
    shutdown('SIGTERM');
    expect(await done).toBe(0);
    expect(order).toEqual(['timers', 'workers', 'queues', 'database']);
    expect(messages).toContain('Received shutdown signal, starting graceful shutdown');
    expect(messages).toContain('HTTP server closed');
    expect(messages.at(-1)).toBe('Graceful shutdown complete');
  });

  it('waits for a request in flight before closing the database', async () => {
    let finishRequest!: () => void;
    const server = await listening((_req, res) => {
      finishRequest = () => res.end('done');
    });
    const port = (server.address() as AddressInfo).port;
    const body = new Promise<string>((resolve) => {
      request({ port, host: '127.0.0.1', path: '/' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }).end();
    });
    await vi.waitFor(() => expect(finishRequest).toBeTypeOf('function'));

    const closed: string[] = [];
    const { exit, done } = exitPromise();
    createShutdown({
      server,
      log: pino({ level: 'silent' }),
      stopTimers: () => {},
      closeWorkers: noop,
      closeQueues: noop,
      closeDatabase: async () => void closed.push('database'),
      exit,
    })('SIGTERM');

    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toEqual([]);
    finishRequest();
    expect(await body).toBe('done');
    expect(await done).toBe(0);
    expect(closed).toEqual(['database']);
  });

  it('runs once when signalled twice', async () => {
    const closeWorkers = vi.fn(noop);
    const { log, messages } = capture();
    const { exit, done } = exitPromise();
    const shutdown = createShutdown({
      server: await listening(),
      log,
      stopTimers: () => {},
      closeWorkers,
      closeQueues: noop,
      closeDatabase: noop,
      exit,
    });
    shutdown('SIGTERM');
    shutdown('SIGINT');
    expect(await done).toBe(0);
    expect(closeWorkers).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(messages).toContain('Shutdown already in progress');
  });

  it('exits 1 at the deadline when a job does not finish', async () => {
    const { log, messages } = capture();
    const { exit, done } = exitPromise();
    createShutdown({
      server: await listening(),
      log,
      stopTimers: () => {},
      closeWorkers: () => new Promise(() => {}),
      closeQueues: noop,
      closeDatabase: noop,
      exit,
      deadlineMs: 50,
    })('SIGTERM');
    expect(await done).toBe(1);
    expect(messages).toContain('Shutdown did not finish in time, exiting');
  });

  it('exits 1 when closing fails, and after a crash', async () => {
    const failing = exitPromise();
    createShutdown({
      server: await listening(),
      log: pino({ level: 'silent' }),
      stopTimers: () => {},
      closeWorkers: noop,
      closeQueues: () => Promise.reject(new Error('redis gone')),
      closeDatabase: noop,
      exit: failing.exit,
    })('SIGTERM');
    expect(await failing.done).toBe(1);

    const crashed = exitPromise();
    createShutdown({
      server: await listening(),
      log: pino({ level: 'silent' }),
      stopTimers: () => {},
      closeWorkers: noop,
      closeQueues: noop,
      closeDatabase: noop,
      exit: crashed.exit,
    })('uncaughtException', true);
    expect(await crashed.done).toBe(1);
  });
});

describe('closeServer', () => {
  it('resolves for a server that never listened', async () => {
    await expect(closeServer(createServer())).resolves.toBeUndefined();
  });
});

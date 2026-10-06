// Node side of the sdk's browser tests: mounts the tus upload contract (the
// same one the node integration tests run against) on the vite dev server at
// /api/v1/uploads, so a real browser uploads through the browser build of
// tus-js-client with its real localStorage.
//
// The suite runs in several browsers at once against this one server, so each
// browser gets its own contract and store, told apart by its User-Agent.
// /__tus/log and /__tus/reset read and clear the calling browser's record.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { createTusContract, type TusContract } from '../__tests__/tus-contract-server.js';
import { BROWSER_API_KEY } from './contract.js';

export function tusContractPlugin(): Plugin {
  const dirs: string[] = [];
  const contracts = new Map<string, TusContract>();
  const fresh = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sluby-sdk-browser-tus-'));
    dirs.push(dir);
    return createTusContract(BROWSER_API_KEY, dir);
  };

  return {
    name: 'sluby-tus-contract',
    configureServer(server) {
      server.httpServer?.on('close', () => {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      });
      server.middlewares.use((req, res, next) => {
        const agent = req.headers['user-agent'] ?? '';
        let contract = contracts.get(agent);
        if (!contract) {
          contract = fresh();
          contracts.set(agent, contract);
        }
        const url = req.url ?? '/';
        if (url.startsWith('/api/v1/uploads')) {
          contract.handle(req, res);
          return;
        }
        if (url === '/__tus/log') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              requests: contract.requests,
              created: contract.created,
              finished: contract.finished,
            }),
          );
          return;
        }
        if (url === '/__tus/reset' && req.method === 'POST') {
          contracts.set(agent, fresh());
          res.end('{}');
          return;
        }
        next();
      });
    },
  };
}

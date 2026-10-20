import { readFile } from 'node:fs/promises';
import { createOpenAPI } from 'fumadocs-openapi/server';

// backend/scripts/export-openapi.ts writes this file, keep the path in sync
const specPath = './public/openapi.json';

export const openapi = createOpenAPI({
  input: {
    sluby: async () => {
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      // the spec's server is "/" (the server that serves it). on the docs site
      // that would point the code samples at the docs host, so show a
      // placeholder server address instead.
      spec.servers = [{ url: 'https://sluby.example.com', description: 'Your Sluby server' }];
      return spec;
    },
  },
});

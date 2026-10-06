import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openapiDocument } from '../api/openapi.js';

// the docs site renders its api reference from a committed copy of the
// document, so a route change that skips the export would leave it stale
const exported = new URL('../../../docs/public/openapi.json', import.meta.url);

describe('docs openapi export', () => {
  it('matches the document the backend serves', () => {
    const committed = JSON.parse(readFileSync(exported, 'utf8'));
    expect(
      committed,
      'docs/public/openapi.json is stale: run npm run openapi:export --workspace=backend',
    ).toEqual(JSON.parse(JSON.stringify(openapiDocument)));
  });
});

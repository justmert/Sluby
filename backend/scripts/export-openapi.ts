// writes the openapi document to the docs site, which renders its api
// reference from this file. openapi-export.test.ts fails when it is stale.
//   npm run openapi:export --workspace=backend
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../src/api/openapi.js';

const target = fileURLToPath(new URL('../../docs/public/openapi.json', import.meta.url));

writeFileSync(target, `${JSON.stringify(openapiDocument, null, 2)}\n`);
console.log(`wrote ${target}`);

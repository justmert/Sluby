import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The interactive API reference at GET /api/v1/docs: Scalar's prebuilt
 * browser bundle, served by this backend from the installed npm package so
 * the page never loads code from a CDN.
 */

// relative to the /api/v1 mount
export const DOCS_ASSET_PATH = '/docs/scalar';

const require = createRequire(import.meta.url);

// the package only exports its vue entry, so resolve that and step over to
// the standalone browser build next to it
export const SCALAR_ASSET_DIR = path.join(
  path.dirname(require.resolve('@scalar/api-reference')),
  'browser',
);

const ENTRY = 'standalone.esm.js';

if (!existsSync(path.join(SCALAR_ASSET_DIR, ENTRY))) {
  throw new Error(`scalar browser bundle not found at ${SCALAR_ASSET_DIR}`);
}

// read by the bundle's html api from the #api-reference element
const configuration = {
  url: '/api/v1/openapi.json',
  authentication: { preferredSecurityScheme: 'bearerAuth' },
  showExtensions: ['x-required-scope'],
  // the defaults reach out to scalar's services: web fonts from their cdn,
  // an ai chat backed by their api, and buttons that send the reader to
  // their hosted client, mcp generator and publishing toolbar
  withDefaultFonts: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  hideClientButton: true,
  showDeveloperTools: 'never',
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sluby API Reference</title>
  </head>
  <body>
    <script id="api-reference" type="application/json" data-configuration="${escapeAttribute(JSON.stringify(configuration))}"></script>
    <script type="module" src="/api/v1${DOCS_ASSET_PATH}/${ENTRY}"></script>
  </body>
</html>
`;

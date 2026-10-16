import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApiRouter, type ApiRouterDeps } from '../api/router.js';
import { openapiDocument } from '../api/openapi.js';

// the docs routes run before the api-key middleware, so no dependency is
// ever called
const stub = new Proxy(() => stub, {
  get: () => stub,
  apply: () => Promise.resolve(null),
}) as unknown as ApiRouterDeps;

const app = express();
app.use('/api/v1', createApiRouter(stub));

async function docsPage() {
  const res = await request(app).get('/api/v1/docs');
  expect(res.status).toBe(200);
  return res;
}

function configuration(html: string) {
  const attr = html.match(/<script id="api-reference"[^>]*data-configuration="([^"]*)"/)?.[1];
  expect(attr, 'no #api-reference configuration in the page').toBeDefined();
  return JSON.parse(
    attr!
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&'),
  );
}

const scriptSources = (html: string) =>
  [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);

describe('GET /api/v1/docs', () => {
  it('serves the reference page without an api key', async () => {
    const res = await docsPage();
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it('loads every script from this server, never a cdn', async () => {
    const { text } = await docsPage();
    const sources = scriptSources(text);
    expect(sources).toEqual(['/api/v1/docs/scalar/standalone.esm.js']);
    expect(text).not.toMatch(/https?:\/\//);
  });

  it('points the reference at the served document and its bearer scheme', async () => {
    const config = configuration((await docsPage()).text);
    expect(config.url).toBe('/api/v1/openapi.json');
    expect(config.authentication.preferredSecurityScheme).toBe('bearerAuth');
    expect(openapiDocument.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it("turns off the defaults that call scalar's hosted services", async () => {
    const config = configuration((await docsPage()).text);
    expect(config.withDefaultFonts).toBe(false);
    expect(config.agent).toEqual({ disabled: true });
    expect(config.mcp).toEqual({ disabled: true });
    expect(config.hideClientButton).toBe(true);
    expect(config.showDeveloperTools).toBe('never');
  });
});

describe('docs assets', () => {
  it('serves the scalar bundle as javascript', async () => {
    const res = await request(app).get('/api/v1/docs/scalar/standalone.esm.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^(text|application)\/javascript/);
    expect(res.text).toContain('createApiReference');
  });

  it('serves the lazy chunks the bundle imports', async () => {
    const entry = await request(app).get('/api/v1/docs/scalar/standalone.esm.js');
    const chunks = [
      ...new Set([...entry.text.matchAll(/["'`]\.\/(chunks\/[^"'`]+\.js)["'`]/g)].map((m) => m[1])),
    ];
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const res = await request(app).get(`/api/v1/docs/scalar/${chunk}`);
      expect(res.status, chunk).toBe(200);
      expect(res.headers['content-type'], chunk).toMatch(/^(text|application)\/javascript/);
    }
  });

  it('answers a missing asset with 404 rather than an auth error', async () => {
    const res = await request(app).get('/api/v1/docs/scalar/nope.js');
    expect(res.status).toBe(404);
  });

  it('does not list directories', async () => {
    const res = await request(app).get('/api/v1/docs/scalar/');
    expect(res.status).toBe(404);
  });
});

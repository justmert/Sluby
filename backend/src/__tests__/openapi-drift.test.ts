import { describe, it, expect } from 'vitest';
import { createApiRouter, type ApiRouterDeps } from '../api/router.js';
import { deliveryRouter } from '../delivery/aggregator.js';
import { listRoutes, canonicalPath } from '../api/list-routes.js';
import { openapiDocument } from '../api/openapi.js';

// Stub deps: the drift test only introspects the router structure, never
// invokes a handler, so every dependency can be a no-op.
const stub = new Proxy(() => stub, {
  get: () => stub,
  apply: () => Promise.resolve(null),
}) as unknown as ApiRouterDeps;

/** METHOD + canonical path for every route actually mounted. */
function mountedRouteKeys(): Set<string> {
  const api = createApiRouter(stub);
  const routes = [...listRoutes(api, '/api/v1'), ...listRoutes(deliveryRouter)];
  return new Set(routes.map((r) => `${r.method} ${r.path}`));
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** METHOD + canonical path for every operation in the spec. */
function specRouteKeys(): Set<string> {
  const keys = new Set<string>();
  for (const [path, item] of Object.entries(openapiDocument.paths)) {
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      keys.add(`${method.toUpperCase()} ${canonicalPath(path)}`);
    }
  }
  return keys;
}

describe('OpenAPI document', () => {
  it('is a structurally valid OpenAPI 3.1 document', () => {
    expect(openapiDocument.openapi).toMatch(/^3\.1\.\d+$/);
    expect(openapiDocument.info.title).toBeTruthy();
    expect(openapiDocument.info.version).toBeTruthy();
    expect(Object.keys(openapiDocument.paths).length).toBeGreaterThan(0);
    expect(openapiDocument.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('gives every operation at least one response', () => {
    for (const [path, item] of Object.entries(openapiDocument.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!HTTP_METHODS.includes(method)) continue;
        const responses = (op as { responses?: Record<string, unknown> }).responses;
        expect(
          responses && Object.keys(responses).length > 0,
          `${method.toUpperCase()} ${path} has no responses`,
        ).toBe(true);
      }
    }
  });
});

describe('OpenAPI drift guard', () => {
  it('documents every mounted route (no undocumented endpoints)', () => {
    const mounted = mountedRouteKeys();
    const spec = specRouteKeys();

    const undocumented = [...mounted].filter((k) => !spec.has(k)).sort();
    expect(
      undocumented,
      `these routes are mounted but missing from openapi.ts:\n${undocumented.join('\n')}`,
    ).toEqual([]);
  });

  it("documents each route's required scope exactly as the code enforces it", () => {
    const api = createApiRouter(stub);
    const routes = listRoutes(api, '/api/v1');

    const mismatches: string[] = [];
    for (const route of routes) {
      const pathItem = Object.entries(openapiDocument.paths).find(
        ([p]) => canonicalPath(p) === route.path,
      )?.[1] as Record<string, { 'x-required-scope'?: string }> | undefined;
      const op = pathItem?.[route.method.toLowerCase()];
      if (!op) continue;

      const documented = op['x-required-scope'];
      const enforced = route.requiredScope;
      if (documented !== enforced) {
        mismatches.push(
          `${route.method} ${route.path}: spec says ${documented ?? '(none)'}, code enforces ${enforced ?? '(none)'}`,
        );
      }
    }

    expect(
      mismatches,
      `openapi x-required-scope disagrees with requireScope():\n${mismatches.join('\n')}`,
    ).toEqual([]);
  });

  it('has no phantom paths (every documented route exists)', () => {
    const mounted = mountedRouteKeys();
    const spec = specRouteKeys();

    const phantom = [...spec].filter((k) => !mounted.has(k)).sort();
    expect(phantom, `these paths are documented but not mounted:\n${phantom.join('\n')}`).toEqual(
      [],
    );
  });
});

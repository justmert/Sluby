/**
 * Minimal Express route introspection, used by the OpenAPI drift-guard
 * test and the api's 404 check to enumerate every route actually mounted on
 * a router. Walks the router's layer stack and recurses into sub-routers.
 *
 * Scoped to the two mounting styles this codebase uses: direct routes
 * (`router.get('/x', ...)`) and sub-routers mounted with mountRouter.
 */
import type { Router } from 'express';

export interface RouteInfo {
  method: string;
  /** Path with params normalized to `:param`, e.g. `/assets/:param`. */
  path: string;
  /** The scope enforced by this route's `requireScope` guard, if any. */
  requiredScope?: string;
  /** `admin` when a `requireAdmin` guard restricts the route. */
  requiredIdentity?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayer = any;

/** Collapse `:id` / `{id}` style params to a single canonical token. */
export function canonicalPath(path: string): string {
  const withParams = path.replace(/\{[^}]+\}/g, ':param').replace(/:[^/]+/g, ':param');
  const collapsed = withParams.replace(/\/+/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1);
  return collapsed;
}

// express 5's router keeps only a matcher function for a mounted path, not
// the path itself, so mountRouter records it here
const mountPaths = new WeakMap<object, string>();

/** Mount a sub-router at a fixed path, and remember the path for listRoutes. */
export function mountRouter(parent: Pick<Router, 'use'>, path: string, child: Router): void {
  mountPaths.set(child, path === '/' ? '' : path);
  parent.use(path, child);
}

export function listRoutes(router: AnyLayer, base = ''): RouteInfo[] {
  const out: RouteInfo[] = [];
  const stack: AnyLayer[] = router?.stack ?? [];

  for (const layer of stack) {
    if (layer.route) {
      const routePath: string = layer.route.path ?? '';
      const methods: Record<string, boolean> = layer.route.methods ?? {};
      // requireScope tags its middleware, so the enforced scope can be read
      // straight off the route's handler chain.
      const handlers: AnyLayer[] = layer.route.stack ?? [];
      const scoped = handlers.find((h: AnyLayer) => h?.handle?.requiredScope);
      const requiredScope: string | undefined = scoped?.handle?.requiredScope;
      const identity = handlers.find((h: AnyLayer) => h?.handle?.requiredIdentity);
      const requiredIdentity: string | undefined = identity?.handle?.requiredIdentity;
      for (const method of Object.keys(methods)) {
        if (!methods[method] || method === '_all') continue;
        out.push({
          method: method.toUpperCase(),
          path: canonicalPath(base + routePath),
          ...(requiredScope ? { requiredScope } : {}),
          ...(requiredIdentity ? { requiredIdentity } : {}),
        });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const prefix = mountPaths.get(layer.handle);
      if (prefix === undefined) {
        throw new Error('A router was mounted without mountRouter, so its routes cannot be listed');
      }
      out.push(...listRoutes(layer.handle, base + prefix));
    }
  }

  return out;
}

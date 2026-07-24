/**
 * Minimal Express route introspection, used by the OpenAPI drift-guard
 * test to enumerate every route actually mounted on a router and compare
 * it against the hand-authored spec. Walks the router's layer stack,
 * recursing into sub-routers and reconstructing their mount prefixes.
 *
 * Scoped to the two mounting styles this codebase uses: direct routes
 * (`router.get('/x', ...)`) and prefix-mounted sub-routers
 * (`router.use('/x', sub)` or `router.use('/', sub)`).
 */

export interface RouteInfo {
  method: string;
  /** Path with params normalized to `:param`, e.g. `/assets/:param`. */
  path: string;
  /** The scope enforced by this route's `requireScope` guard, if any. */
  requiredScope?: string;
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

/** Reconstruct a sub-router's mount prefix from its layer regexp. */
function mountPrefix(layer: AnyLayer): string {
  const regexp = layer.regexp;
  if (!regexp || regexp.fast_slash) return '';
  const source: string = regexp.source ?? '';
  // Matches the express-generated form `^\/uploads\/?(?=\/|$)`.
  const m = source.match(/^\^\\\/(.*?)\\\/\?\(\?=/);
  if (m && m[1]) return '/' + m[1].replace(/\\\//g, '/');
  return '';
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
      for (const method of Object.keys(methods)) {
        if (!methods[method] || method === '_all') continue;
        out.push({
          method: method.toUpperCase(),
          path: canonicalPath(base + routePath),
          ...(requiredScope ? { requiredScope } : {}),
        });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...listRoutes(layer.handle, base + mountPrefix(layer)));
    }
  }

  return out;
}

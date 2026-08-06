/**
 * The TUS server and the REST upload routes share the `/api/v1/uploads`
 * path. This predicate decides which one handles a given request so TUS
 * does not shadow the REST endpoints (JSON session creation, status,
 * cancel).
 *
 * A request is TUS if it carries the `Tus-Resumable` header (every TUS
 * client sends it on creation/HEAD/PATCH/DELETE) or uses a verb that only
 * TUS uses on this path (PATCH to append bytes, HEAD to read the offset,
 * OPTIONS for protocol discovery). Everything else is a plain REST call.
 */
export function isTusRequest(req: { method: string; headers: Record<string, unknown> }): boolean {
  if (req.headers['tus-resumable'] !== undefined) return true;
  return req.method === 'PATCH' || req.method === 'HEAD' || req.method === 'OPTIONS';
}

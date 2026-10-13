import { describe, expect, it } from 'vitest';
import { openapiDocument } from '../../../backend/src/api/openapi';
import { REQUEST_TEMPLATES } from './explorer-templates';
import { buildSnippets } from './snippets';

// every path the studio shows a developer must be a documented route; the
// backend's drift test in turn guarantees documented routes are mounted

type Method = 'get' | 'post' | 'patch' | 'delete';
const paths = openapiDocument.paths as Record<string, Partial<Record<Method, unknown>>>;

function documented(method: string, rawPath: string): boolean {
  const path = rawPath.split('?')[0].replace(/\/YOUR_[A-Z_]+/g, '/{id}');
  return Object.entries(paths).some(
    ([template, ops]) =>
      method.toLowerCase() in ops &&
      new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
  );
}

describe('studio api references', () => {
  it.each(REQUEST_TEMPLATES.map((t) => [t.method, t.path]))(
    'explorer template %s %s is a documented route',
    (method, path) => {
      expect(documented(method, path)).toBe(true);
    },
  );

  it('every curl call in the snippets is a documented route', () => {
    const base = 'https://studio.example.com';
    for (const s of buildSnippets(base)) {
      // tus PATCH/HEAD go to $LOCATION, not a fixed path
      for (const m of s.curl.matchAll(
        /curl[^\n"]*?(?:-X (\w+) )?"https:\/\/studio\.example\.com([^"]+)"/g,
      )) {
        const method = m[1] ?? 'GET';
        expect({ snippet: s.id, method, path: m[2], ok: documented(method, m[2]) }).toMatchObject({
          ok: true,
        });
      }
    }
  });
});

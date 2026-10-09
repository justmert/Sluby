import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// the studio's own files a module pulls in at load time, following static
// imports only: a dynamic import() starts its own chunk
const SRC = resolve(__dirname, '..');

function file(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec);
  if (/\.tsx?$/.test(base) && existsSync(base)) return base;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function staticPackages(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
    for (const node of source.statements) {
      const spec =
        (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && !node.isTypeOnly)
          ? node.moduleSpecifier
          : undefined;
      if (!spec || !ts.isStringLiteral(spec)) continue;
      const name = spec.text;
      if (name.startsWith('.') || name.startsWith('@/')) {
        const next = file(name, path);
        if (next) queue.push(next);
      } else {
        packages.add(name);
      }
    }
  }
  return packages;
}

describe('page chunks', () => {
  // hls.js is the biggest dependency; only a ready video's player needs it
  it.each(['pages/studio/AssetsPage.tsx', 'pages/studio/AssetDetailPage.tsx'])(
    '%s loads the player only when it shows one',
    (entry) => {
      expect(staticPackages(entry).has('@sluby/player')).toBe(false);
    },
  );
});

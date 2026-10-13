import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { buildSnippets } from './snippets';

const frontendDir = path.resolve(__dirname, '../..');
const snippets = buildSnippets('https://studio.example.com');

/**
 * Compile every javascript snippet against the real sdk and player sources,
 * as a reader would paste it into a typescript project.
 */
function typecheckSnippets() {
  const files = new Map(
    snippets.map((s) => [path.join(frontendDir, `__snippet_${s.id}.${s.js.lang}`), s.js.code]),
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
    baseUrl: frontendDir,
    paths: {
      '@sluby/sdk': ['../packages/sdk/src/index.ts'],
      '@sluby/player': ['../packages/player/src/index.ts'],
    },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang, onError, create) =>
    files.has(fileName)
      ? ts.createSourceFile(fileName, files.get(fileName)!, lang)
      : getSourceFile(fileName, lang, onError, create);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => files.has(f) || fileExists(f);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => files.get(f) ?? readFile(f);

  const program = ts.createProgram([...files.keys()], options, host);
  const errors = new Map<string, string[]>();
  for (const [file] of files) {
    const diags = ts.getPreEmitDiagnostics(program, program.getSourceFile(file));
    errors.set(
      path.basename(file),
      diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    );
  }
  return errors;
}

describe('developer snippets', () => {
  it('typecheck against the real sdk and player', () => {
    const errors = typecheckSnippets();
    for (const [file, messages] of errors) {
      expect({ file, messages }).toEqual({ file, messages: [] });
    }
  }, 60_000);

  it('use the given base url and never a hardcoded host', () => {
    for (const s of snippets) {
      const both = s.js.code + s.curl;
      expect(both).not.toMatch(/localhost|api\.sluby\.app/);
      if (s.curl.includes('http')) expect(s.curl).toContain('https://studio.example.com/');
    }
  });

  it('quote every curl url so query strings survive the shell', () => {
    for (const s of snippets) {
      for (const m of s.curl.matchAll(/curl[^\n]*?(https?:\/\/\S+)/g)) {
        expect(m[0]).toMatch(/"https?:\/\/[^"]+"/);
      }
    }
  });
});

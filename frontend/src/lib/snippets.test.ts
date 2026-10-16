import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  findOperation,
  itemSchema,
  propertySchema,
  responseSchema,
  type Schema,
} from '@/test/openapi';
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
    // absolute, since typescript 6 deprecates baseUrl
    paths: {
      '@sluby/sdk': [path.join(frontendDir, '../packages/sdk/src/index.ts')],
      '@sluby/player': [path.join(frontendDir, '../packages/player/src/index.ts')],
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
  return { errors, program, files };
}

const compiled = typecheckSnippets();

/** Fields a declared type reads that the documented schema does not have. */
function undocumentedFields(
  checker: ts.TypeChecker,
  type: ts.Type,
  schema: Schema,
  at: string,
): string[] {
  return checker.getPropertiesOfType(type).flatMap((prop) => {
    const field = `${at}.${prop.name}`;
    const fieldSchema = propertySchema(schema, prop.name);
    if (!fieldSchema) return [field];
    const fieldType = checker.getNonNullableType(checker.getTypeOfSymbol(prop));
    if (checker.isArrayType(fieldType)) {
      const [element] = checker.getTypeArguments(fieldType as ts.TypeReference);
      const items = itemSchema(fieldSchema);
      return items && element.flags & ts.TypeFlags.Object
        ? undocumentedFields(checker, element, items, `${field}[]`)
        : [];
    }
    return fieldType.flags & ts.TypeFlags.Object
      ? undocumentedFields(checker, fieldType, fieldSchema, field)
      : [];
  });
}

/**
 * Each fetch snippet's json results, paired in order with its fetch calls:
 * whether each is typed, and which typed fields the answer does not have.
 */
function fetchResultProblems(): Map<string, string[]> {
  const { program, files } = compiled;
  const checker = program.getTypeChecker();
  const out = new Map<string, string[]>();
  for (const [file, code] of files) {
    const urls = [...code.matchAll(/fetch\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\}\)/g)].map((m) => ({
      path: new URL(m[1]).pathname,
      method: /method:\s*'(\w+)'/.exec(m[2])?.[1] ?? 'GET',
    }));
    if (urls.length === 0) continue;
    const results: ts.VariableDeclaration[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer?.getText().includes('.json()')) {
        results.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(program.getSourceFile(file)!);
    const problems: string[] = [];
    if (results.length !== urls.length)
      problems.push(`${urls.length} fetches, ${results.length} json results`);
    results.forEach((decl, i) => {
      const name = decl.name.getText();
      if (!decl.type) return problems.push(`${name} is untyped (any)`);
      const op = urls[i] && findOperation(urls[i].method, urls[i].path);
      const schema = op && responseSchema(op);
      if (!schema) return problems.push(`no documented answer for ${name}`);
      problems.push(
        ...undocumentedFields(checker, checker.getTypeFromTypeNode(decl.type), schema, name).map(
          (f) => `${f} is not in the documented answer`,
        ),
      );
    });
    out.set(path.basename(file), problems);
  }
  return out;
}

describe('developer snippets', () => {
  it('typecheck against the real sdk and player', () => {
    for (const [file, messages] of compiled.errors) {
      expect({ file, messages }).toEqual({ file, messages: [] });
    }
  });

  it('type every fetch answer with fields the api documents', () => {
    const checked = fetchResultProblems();
    expect([...checked.keys()].sort()).toEqual(['__snippet_keys.ts', '__snippet_storage.ts']);
    for (const [file, problems] of checked) {
      expect({ file, problems }).toEqual({ file, problems: [] });
    }
  });

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

  it('keep api keys out of browser code', () => {
    for (const snippet of snippets) {
      const holdsKey = /apiKey:|SLUBY_API_KEY/.test(snippet.js.code);
      const runsInBrowser = /\bdocument\.|\bwindow\.|<SlubyPlayer/.test(snippet.js.code);
      expect({ id: snippet.id, holdsKey, runsInBrowser }).not.toMatchObject({
        holdsKey: true,
        runsInBrowser: true,
      });
    }
  });

  it('retry a failed asset where waitForReady actually reports the failure', () => {
    const sf = ts.createSourceFile(
      'processing.ts',
      snippets.find((x) => x.id === 'processing')!.js.code,
      ts.ScriptTarget.ES2022,
      true,
    );
    const retries: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText().endsWith('.retry')) {
        retries.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(retries).toHaveLength(1);
    let inCatch = false;
    for (let n: ts.Node | undefined = retries[0]; n; n = n.parent) {
      if (ts.isCatchClause(n)) inCatch = true;
    }
    expect(inCatch).toBe(true);
  });

  it('decode a webhook body once, after every chunk arrived, and check the timestamped signature', () => {
    const code = snippets.find((x) => x.id === 'webhooks')!.js.code;
    expect(code).toContain('Buffer.concat(chunks).toString');
    expect(code).not.toMatch(/\+=\s*chunk/);
    expect(code).toContain('verifyRequest(body, req.headers, secret)');
  });

  it('print the created asset id from the tus metadata, decoded', () => {
    const curl = snippets.find((x) => x.id === 'upload')!.curl;
    const step3 = curl.slice(curl.indexOf('# 3.')).replace(/\\\n\s*/g, ' ');
    const pipeline = step3.slice(step3.indexOf('| grep'));
    const assetId = '6c1b2f3e-0000-4000-8000-00000000abcd';
    const b64 = (v: string) => Buffer.from(v).toString('base64');
    const head = [
      'HTTP/1.1 200 OK',
      'Access-Control-Expose-Headers: Upload-Offset, Upload-Metadata, Location',
      `Upload-Metadata: filename ${b64('video.mp4')},videoAssetId ${b64(assetId)},title ${b64('My video')}`,
      '',
    ].join('\r\n');
    const out = execFileSync('sh', ['-c', `cat ${pipeline}`], { input: head }).toString();
    expect(out.trim()).toBe(assetId);
  });
});

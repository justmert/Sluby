import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * the copy rules (lib/copy.md, plan D-29) checked over every product file:
 * what a reader sees must not say "...", show "-" for nothing, call a video
 * an asset, say url or id in lower case, talk about pinning or
 * reconciliation, or use an em dash. tests and the developers pages' code
 * samples are left out where the rule says so.
 */

const SRC = path.resolve(__dirname, '..');

function productFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : productFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.d.ts')) return [];
    return [full];
  });
}

export interface Finding {
  rule: string;
  file: string;
  line: number;
  text: string;
}

const EM_DASH = '—';

// "asset" is the api's word; the developers pages show code and api calls,
// and the explorer's templates are api requests
const ASSET_ALLOWED = [/^pages\/studio\/developers\//, /^lib\/explorer-templates\.ts$/];

/** A string a reader may see: anything with a letter in it that is not a path, a url or a class list. */
function isProse(node: ts.Node, text: string): boolean {
  if (!/[a-z]/i.test(text)) return false;
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    return ['aria-label', 'title', 'placeholder', 'alt', 'label', 'description'].includes(name);
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isElementAccessExpression(parent)) return false;
  // a sentence has a space; a key, a path or an event name does not
  return /\s/.test(text.trim());
}

/** Is a "-" literal standing in for a missing value, rather than a separator passed to a call? */
function isEmptyValue(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isConditionalExpression(parent)) return parent.condition !== node;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    return (
      parent.right === node &&
      (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
    );
  }
  return ts.isJsxExpression(parent) || ts.isReturnStatement(parent);
}

export function lintSource(rel: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const file = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const add = (rule: string, node: ts.Node | number, text: string) => {
    const pos = typeof node === 'number' ? node : node.getStart(file);
    findings.push({
      rule,
      file: rel,
      line: file.getLineAndCharacterOfPosition(pos).line + 1,
      text: text.trim().slice(0, 80),
    });
  };

  // anywhere at all, comments included
  let at = source.indexOf(EM_DASH);
  while (at !== -1) {
    add('em dash', at, source.slice(Math.max(0, at - 30), at + 30));
    at = source.indexOf(EM_DASH, at + 1);
  }

  const assetAllowed = ASSET_ALLOWED.some((re) => re.test(rel));

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(file);
      if (text.trim() !== '') {
        if (text.includes('...')) add('three dots', node, text);
        if (text.trim() === '-') add('hyphen for nothing', node, text);
        // an api path shown as code (/playback/:id) is not prose
        if (/(?<![:/{])\b(url|urls|id|ids)\b(?![/}])/.test(text)) {
          add('lower-case url or id', node, text);
        }
        if (!assetAllowed && /\bassets?\b/i.test(text)) add('asset', node, text);
        if (/\b(un)?pinned\b|\breconciliation\b/i.test(text)) add('sia internals', node, text);
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      if (text === '-' && isEmptyValue(node)) add('hyphen for nothing', node, text);
      if (isProse(node, text)) {
        if (text.includes('...')) add('three dots', node, text);
        if (/\b(un)?pinned\b|\breconciliation\b/i.test(text)) add('sia internals', node, text);
      }
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
      if (/\s/.test(parts.trim()) && parts.includes('...')) add('three dots', node, parts);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/*
 * findings allowed for now, file by file. empty since every page was fixed;
 * anything new fails at once, and an entry that gets fixed fails the test
 * until it is taken out, so the list can only shrink.
 */
const KNOWN: Array<[string, string, number]> = [
  // [file, rule, count]
];

const key = (f: { file: string; rule: string }) => `${f.file} | ${f.rule}`;

describe('copy rules (D-29)', () => {
  const all = productFiles(SRC).flatMap((full) =>
    lintSource(path.relative(SRC, full).split(path.sep).join('/'), readFileSync(full, 'utf8')),
  );

  it('finds nothing beyond the known list, and the known list is not stale', () => {
    const counts = new Map<string, number>();
    for (const f of all) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
    const known = new Map(KNOWN.map(([file, rule, n]) => [`${file} | ${rule}`, n]));
    const unexpected = all.filter((f) => (counts.get(key(f)) ?? 0) > (known.get(key(f)) ?? 0));
    const stale = [...known].filter(([k, n]) => (counts.get(k) ?? 0) < n);
    expect(
      unexpected.map((f) => `${f.file}:${f.line} ${f.rule}: ${f.text}`),
      'copy that breaks lib/copy.md',
    ).toEqual([]);
    expect(
      stale.map(([k, n]) => `${k}: listed ${n}, found ${counts.get(k) ?? 0}`),
      'fixed: lower or remove these KNOWN entries',
    ).toEqual([]);
  });
});

describe('the copy lint itself', () => {
  const rules = (src: string, file = 'components/x.tsx') =>
    lintSource(file, src).map((f) => f.rule);

  it('catches each rule in ui text', () => {
    expect(rules('const a = <p>Loading...</p>;')).toEqual(['three dots']);
    expect(rules("const a = toast('Saving the video...');")).toEqual(['three dots']);
    expect(rules("const a = <span>{x ?? '-'}</span>;")).toEqual(['hyphen for nothing']);
    expect(rules('const a = <dd>-</dd>;')).toEqual(['hyphen for nothing']);
    expect(rules('const a = <p>Copy the id</p>;')).toEqual(['lower-case url or id']);
    expect(rules('const a = <p>Open the asset</p>;')).toEqual(['asset']);
    expect(rules("const a = toast('Objects unpinned from Sia');")).toEqual(['sia internals']);
    expect(rules('const a = <h2>Reconciliation</h2>;')).toEqual(['sia internals']);
    expect(rules(`// a note ${EM_DASH} with a dash`)).toEqual(['em dash']);
  });

  it('leaves code alone', () => {
    expect(rules("const a = parts.join('-');")).toEqual([]);
    expect(rules("const a = { ...rest, id: '1' };")).toEqual([]);
    expect(rules("const k = ['reconciliation'];")).toEqual([]);
    expect(rules("const p = apiClient.get('/reconciliation');")).toEqual([]);
    expect(rules('const a = <p>Video ID and URL</p>;')).toEqual([]);
    expect(rules('const a = <code>GET /api/v1/playback/:id/signed</code>;')).toEqual([]);
    expect(
      rules(
        'const a = <p>A video is called an asset in the API.</p>;',
        'pages/studio/developers/QuickstartPage.tsx',
      ),
    ).toEqual([]);
  });
});

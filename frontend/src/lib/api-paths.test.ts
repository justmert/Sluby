import { describe, expect, it } from 'vitest';
import { checkValue, findOperation, queryParams, requestSchema } from '@/test/openapi';
import { REQUEST_TEMPLATES } from './explorer-templates';
import { buildSnippets } from './snippets';

// every call the studio shows a developer must be a documented route, with
// documented query parameters and a body the request schema accepts; the
// backend's drift test in turn guarantees documented routes are mounted

const BASE = 'https://studio.example.com';
const snippets = buildSnippets(BASE);

interface Call {
  method: string;
  url: string;
  body?: string;
}

/** Shell words of one command, quotes removed; stops at an unquoted pipe or `)`. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let depth = 0; // $( ... ) inside double quotes
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (quote === '"' && c === '$' && command[i + 1] === '(') depth++;
      if (quote === '"' && c === ')' && depth > 0) depth--;
      if (c === quote && depth === 0) quote = null;
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (c === '|' || c === ')') break;
    if (/\s/.test(c)) {
      if (started) words.push(word);
      word = '';
      started = false;
      continue;
    }
    word += c;
    started = true;
  }
  if (started) words.push(word);
  return words;
}

/** Every curl invocation in a snippet, with its method, url and body. */
function curlCalls(text: string): Call[] {
  const joined = text.replace(/\\\n\s*/g, ' ');
  const calls: Call[] = [];
  for (const line of joined.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    for (const m of line.matchAll(/\bcurl\s/g)) {
      const words = shellWords(line.slice(m.index));
      let method = 'GET';
      let url: string | undefined;
      let body: string | undefined;
      for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if (w === '-X') method = words[++i];
        else if (w === '-I') method = 'HEAD';
        else if (w === '-d' || w === '--data') body = words[++i];
        else if (['-H', '-D', '-o', '--data-binary'].includes(w)) i++;
        else if (!w.startsWith('-')) url = w;
      }
      if (body !== undefined && method === 'GET') method = 'POST';
      calls.push({ method, url: url ?? '', body });
    }
  }
  return calls;
}

/** fetch() calls in a javascript snippet, with the method and JSON.stringify body. */
function fetchCalls(code: string): Call[] {
  const calls: Call[] = [];
  for (const m of code.matchAll(/fetch\(\s*['`]([^'`]+)['`]\s*,\s*\{/g)) {
    // the options object runs to the matching brace
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++;
      if (code[end] === '}' && --depth === 0) break;
    }
    const options = code.slice(m.index + m[0].length - 1, end + 1);
    const method = /method:\s*'(\w+)'/.exec(options)?.[1] ?? 'GET';
    const literal = /JSON\.stringify\((\{[\s\S]*?\})\)/.exec(options)?.[1];
    // our own snippet source, evaluated to compare it with the schema
    const body = literal ? JSON.stringify(new Function(`return (${literal})`)()) : undefined;
    calls.push({ method, url: m[1], body });
  }
  return calls;
}

function problems(call: Call): string[] {
  if (call.url === '$LOCATION') {
    // tus calls on the upload url the creation answered with
    return ['PATCH', 'HEAD'].includes(call.method) ? [] : [`${call.method} $LOCATION`];
  }
  if (!call.url.startsWith(`${BASE}/`)) return [`not on the base url: ${call.url}`];
  const url = new URL(call.url);
  const op = findOperation(call.method, url.pathname);
  if (!op) return [`undocumented ${call.method} ${url.pathname}`];
  const known = queryParams(op);
  const errors = [...url.searchParams.keys()]
    .filter((k) => !known.has(k))
    .map((k) => `undocumented query parameter ${k}`);
  if (call.body !== undefined) {
    const schema = requestSchema(op);
    if (!schema) errors.push('a body where none is documented');
    else errors.push(...checkValue(JSON.parse(call.body), schema));
  }
  return errors;
}

describe('studio api references', () => {
  it.each(REQUEST_TEMPLATES.map((t) => [t.method, t.path, t.body]))(
    'explorer template %s %s is a documented call',
    (method, path, body) => {
      expect(problems({ method: method!, url: `${BASE}${path}`, body: body ?? undefined })).toEqual(
        [],
      );
    },
  );

  it('finds every curl call, including one with a quoted argument before the url', () => {
    expect(curlCalls('curl -s -H "Accept: x" "https://h/a" \\\n  -d \'{"a": 1}\'')).toEqual([
      { method: 'POST', url: 'https://h/a', body: '{"a": 1}' },
    ]);
    for (const s of snippets) {
      const commands = s.curl
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('#'))
        .join('\n')
        .match(/\bcurl\s/g);
      expect({ snippet: s.id, parsed: curlCalls(s.curl).length }).toEqual({
        snippet: s.id,
        parsed: commands?.length ?? 0,
      });
    }
    expect(snippets.flatMap((s) => curlCalls(s.curl)).length).toBeGreaterThanOrEqual(12);
  });

  it('every curl call is documented, with documented query parameters and a valid body', () => {
    for (const s of snippets) {
      for (const call of curlCalls(s.curl)) {
        expect({ snippet: s.id, ...call, problems: problems(call) }).toMatchObject({
          problems: [],
        });
      }
    }
  });

  it('every fetch call in the javascript is documented, with a valid body', () => {
    const calls = snippets.flatMap((s) => fetchCalls(s.js.code).map((c) => ({ s: s.id, c })));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const { s, c } of calls) {
      expect({ snippet: s, ...c, problems: problems(c) }).toMatchObject({ problems: [] });
    }
  });

  it('catches a wrong event name or body field', () => {
    expect(
      problems({
        method: 'POST',
        url: `${BASE}/api/v1/webhooks`,
        body: '{"url": "https://x", "events": ["asset.done"]}',
      }),
    ).toEqual(['body.events[0]: "asset.done" not in enum']);
    expect(
      problems({
        method: 'POST',
        url: `${BASE}/api/v1/keys/k/rotate`,
        body: '{"grace_seconds": 5}',
      }),
    ).toEqual(['body.grace_seconds: not documented']);
    expect(problems({ method: 'GET', url: `${BASE}/api/v1/assets?colour=red` })).toEqual([
      'undocumented query parameter colour',
    ]);
  });
});

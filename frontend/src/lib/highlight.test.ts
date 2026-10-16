import { describe, expect, it } from 'vitest';
import { tokenize } from './highlight';

const types = (code: string, lang: Parameters<typeof tokenize>[1]) =>
  tokenize(code, lang)
    .filter((t) => t.type !== 'plain')
    .map((t) => `${t.type}:${t.text}`);

describe('tokenize', () => {
  it('colors typescript keywords, strings, comments and calls', () => {
    expect(types(`// set up\nconst sluby = new SlubyClient({ apiKey: 'k' });`, 'ts')).toEqual([
      'comment:// set up',
      'keyword:const',
      'keyword:new',
      'fn:SlubyClient',
      "string:'k'",
    ]);
  });

  it('does not find a keyword inside a longer word', () => {
    expect(types('constant newer', 'ts')).toEqual([]);
  });

  it('colors curl commands, flags, variables and strings', () => {
    expect(types(`curl -X POST "$URL/api" \\\n  -H 'x: y'`, 'bash')).toEqual([
      'fn:curl',
      'keyword:-X',
      'string:"$URL/api"',
      'keyword:-H',
      "string:'x: y'",
    ]);
  });

  it('tells json keys from string values', () => {
    expect(types('{"id": "abc", "n": 2, "ok": true}', 'json')).toEqual([
      'keyword:"id"',
      'string:"abc"',
      'keyword:"n"',
      'number:2',
      'keyword:"ok"',
      'keyword:true',
    ]);
  });

  it('keeps every character, in order', () => {
    const code = `<SlubyPlayer src={url} />\nexport SLUBY_API_KEY=sluby_x`;
    expect(
      tokenize(code, 'tsx')
        .map((t) => t.text)
        .join(''),
    ).toBe(code);
    expect(
      tokenize(code, 'bash')
        .map((t) => t.text)
        .join(''),
    ).toBe(code);
  });
});

/*
 * a small syntax highlighter for the studio's own snippets (ts, tsx, bash,
 * json, html). it only has to color code we wrote, so a few regexes per
 * language are enough; a full grammar library would cost ~30 kB gzip for the
 * same result. anything it does not recognise stays plain text.
 */

export type CodeLanguage = 'ts' | 'tsx' | 'js' | 'bash' | 'json' | 'html' | 'text';

export type TokenType =
  'comment' | 'string' | 'keyword' | 'number' | 'fn' | 'variable' | 'tag' | 'plain';

export interface Token {
  type: TokenType;
  text: string;
}

const JS_KEYWORDS =
  'const|let|var|function|return|if|else|for|while|of|in|new|await|async|import|from|export|default|class|extends|try|catch|finally|throw|typeof|instanceof|true|false|null|undefined|this|interface|type|as|void|break|continue|switch|case';

type Rule = [TokenType, RegExp];

// every rule is tried at the current position; the first that matches wins
const RULES: Record<Exclude<CodeLanguage, 'text'>, Rule[]> = {
  ts: [
    ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ['string', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/y],
    ['tag', /<\/?[A-Z][\w.]*|<\/?[a-z][\w-]*(?=[\s>/])|\/?>/y],
    ['keyword', new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, 'y')],
    ['number', /\b\d[\d_]*(?:\.\d+)?\b/y],
    ['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/y],
  ],
  tsx: [],
  js: [],
  bash: [
    ['comment', /#[^\n]*/y],
    ['string', /'[^']*'|"(?:\\.|[^"\\])*"/y],
    ['variable', /\$\{?[A-Za-z_][\w]*\}?/y],
    ['keyword', /(?<=\s|^)--?[A-Za-z][\w-]*/y],
    ['fn', /(?<=^|\n|\|\s*|&&\s*)(?:curl|npm|npx|export|node|docker|echo)\b/y],
  ],
  json: [
    // keys take the petrol of names, as in the json viewer
    ['fn', /"(?:\\.|[^"\\])*"(?=\s*:)/y],
    ['string', /"(?:\\.|[^"\\])*"/y],
    ['number', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ['keyword', /\b(?:true|false|null)\b/y],
  ],
  html: [
    ['comment', /<!--[\s\S]*?-->/y],
    ['tag', /<\/?[A-Za-z][\w-]*|\/?>/y],
    ['string', /"[^"]*"|'[^']*'/y],
    ['keyword', /\b[a-z-]+(?==)/y],
  ],
};
RULES.tsx = RULES.ts;
RULES.js = RULES.ts;

/** Splits code into colored tokens; adjacent plain text is merged. */
export function tokenize(code: string, language: CodeLanguage): Token[] {
  if (language === 'text') return [{ type: 'plain', text: code }];
  const rules = RULES[language];
  const out: Token[] = [];
  let plain = '';
  let i = 0;
  outer: while (i < code.length) {
    for (const [type, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length > 0) {
        if (plain) {
          out.push({ type: 'plain', text: plain });
          plain = '';
        }
        out.push({ type, text: m[0] });
        i += m[0].length;
        continue outer;
      }
    }
    // step over a whole word at once, so a keyword is never matched inside one
    const word = /[A-Za-z0-9_$]+|[^]/y;
    word.lastIndex = i;
    const w = word.exec(code)![0];
    plain += w;
    i += w.length;
  }
  if (plain) out.push({ type: 'plain', text: plain });
  return out;
}

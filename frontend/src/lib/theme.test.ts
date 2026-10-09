import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, THEME_STORAGE_KEY, parseTheme, resolveTheme } from './theme';

// the inline script index.html runs before first paint
const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

function runInline(stored: string | null, systemDark: boolean): string {
  document.documentElement.className = '';
  localStorage.clear();
  if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: systemDark } as MediaQueryList);
  new Function(inline)();
  return document.documentElement.className;
}

afterEach(() => vi.restoreAllMocks());

describe('the theme before first paint', () => {
  it.each([
    [null, false],
    [null, true],
    ['light', true],
    ['dark', false],
    ['system', false],
    ['system', true],
    ['purple', false],
  ])('index.html picks what the provider picks for saved %s, os dark %s', (stored, dark) => {
    expect(runInline(stored, dark)).toBe(resolveTheme(parseTheme(stored), dark));
  });
});

describe('the theme default', () => {
  it('follows the system, in the provider and in index.html', () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(runInline(null, false)).toBe('light');
    expect(runInline(null, true)).toBe('dark');
  });
});

// the nginx csp lets the inline script run by its hash, so any edit to the
// script has to change the hash in the same commit or the theme never applies
describe('the inline theme script and the csp', () => {
  const conf = readFileSync(
    path.resolve(__dirname, '../../../nginx/conf.d/sia-aggregator.conf'),
    'utf8',
  );

  it('is the only inline script in index.html', () => {
    expect([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]).toHaveLength(1);
  });

  it('is allowed by its sha256 in every csp nginx sends', () => {
    const hash = createHash('sha256').update(inline).digest('base64');
    const csps = [...conf.matchAll(/Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
    expect(csps.length).toBeGreaterThan(0);
    for (const csp of csps) {
      const scriptSrc = /script-src ([^;]+)/.exec(csp)![1];
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
      // one hash only: a stale one left beside the new one would hide a drift
      expect(scriptSrc.match(/'sha256-/g)).toHaveLength(1);
    }
  });
});

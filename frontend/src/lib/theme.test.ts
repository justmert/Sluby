import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, parseTheme, resolveTheme } from './theme';

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

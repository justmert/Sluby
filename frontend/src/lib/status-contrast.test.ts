import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// the status tokens are text on the app's surfaces: badges sit on cards, on a
// selected row and on the palette's highlighted row (opaque muted), and the
// badge fill is the card itself. this reads the real tokens from index.css
// and computes WCAG contrast, so a palette change that drops one under the
// line fails here
const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
}

type Rgb = [number, number, number];

function token(scope: string, name: string): Rgb {
  const m = new RegExp(`--${name}: #([0-9a-f]{6});`).exec(block(scope));
  if (!m) throw new Error(`no opaque --${name} in ${scope}`);
  const hex = m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (x: Rgb, y: Rgb) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ['card', 'popover', 'muted', 'background'];

describe('status text keeps 4.5:1 on every surface it sits on', () => {
  for (const scope of [':root', '.dark']) {
    for (const status of [
      'success',
      'destructive',
      'info',
      'progress-foreground',
      'warning-foreground',
      'primary',
      'muted-foreground',
    ]) {
      for (const surface of SURFACES) {
        it(`${scope} ${status} on ${surface}`, () => {
          expect(ratio(token(scope, status), token(scope, surface))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe('the edge of an empty field keeps 3:1', () => {
  for (const scope of [':root', '.dark']) {
    for (const surface of SURFACES) {
      it(`${scope} input on ${surface}`, () => {
        expect(ratio(token(scope, 'input'), token(scope, surface))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('text on solid fills keeps 4.5:1', () => {
  for (const scope of [':root', '.dark']) {
    it(`${scope} primary-foreground on primary`, () => {
      expect(
        ratio(token(scope, 'primary-foreground'), token(scope, 'primary')),
      ).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scope} destructive-solid-foreground on destructive-solid`, () => {
      expect(
        ratio(token(scope, 'destructive-solid-foreground'), token(scope, 'destructive-solid')),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

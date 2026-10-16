import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// the status tokens are text on the app's surfaces: badges on cards, on a
// selected row and on the palette's highlighted row (opaque muted). this
// reads the real tokens from index.css and computes WCAG contrast, so a
// palette change that drops one under 4.5:1 fails here
const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(scope: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(block(scope));
  if (!m) throw new Error(`no opaque --${name} in ${scope}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

type Rgb = [number, number, number];

// oklch to gamma-encoded srgb, 0..1
function srgb([l, c, h]: [number, number, number]): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return linear.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) as Rgb;
}

// the badge tint: the status color at an alpha over the surface, as the browser composites it
const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  top.map((t, i) => t * alpha + under[i] * (1 - alpha)) as Rgb;

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (x: Rgb, y: Rgb) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

describe('status badges keep 4.5:1 on every surface they sit on', () => {
  // badge.tsx: text-{status} on bg-{status}/10, /15 in dark
  for (const [scope, tint] of [
    [':root', 0.1],
    ['.dark', 0.15],
  ] as const) {
    for (const status of ['success', 'destructive', 'info']) {
      for (const surface of ['card', 'popover', 'muted', 'background']) {
        it(`${scope} ${status} on ${surface}`, () => {
          const text = srgb(token(scope, status));
          const bg = over(text, tint, srgb(token(scope, surface)));
          expect(ratio(text, bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

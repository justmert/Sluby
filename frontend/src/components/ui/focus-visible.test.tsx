import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { ChartContainer } from './chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

// these take keyboard focus (a tab panel, a scrolling code block, a chart
// surface), so each needs the same visible ring as the buttons around it
describe('focusable surfaces show a focus ring', () => {
  it('tab panels', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tabpanel')).toHaveClass('focus-visible:ring-3');
  });

  it('code blocks', () => {
    const { container } = render(<CodeBlock code="npm i" label="install" />);
    expect(container.querySelector('pre')).toHaveClass('focus-visible:ring-3');
  });

  it('chart surfaces', () => {
    const { container } = render(
      <ChartContainer config={{}}>
        <svg />
      </ChartContainer>,
    );
    const chart = container.querySelector('[data-slot=chart]')!;
    expect(chart.className).toContain('[&_.recharts-surface:focus-visible]:outline-ring');
    // outline-hidden on the surface sets the style to none; focus has to set it back
    expect(chart.className).toContain('[&_.recharts-surface:focus-visible]:outline-solid');
  });
});

const css = async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  return readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
};
const forcedBlock = async () =>
  /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(await css())![1];

describe('forced colors', () => {
  it('drops the resting transparent outline that forced colors would paint on every item', async () => {
    expect(await forcedBlock()).toMatch(
      /\.outline-hidden:not\(:focus-visible\)\s*\{\s*outline-style: none;/,
    );
  });

  it('marks the highlighted menu, select and palette option', async () => {
    const block = await forcedBlock();
    expect(block).toMatch(
      /\[data-highlighted\],\s*\[cmdk-item\]\[data-selected='true'\]\s*\{\s*outline: 2px solid Highlight;/,
    );
  });

  it('keeps the selected tab and the pressed toggle visible without their backgrounds', async () => {
    const block = await forcedBlock();
    for (const sel of [
      "[data-slot='tabs-trigger'][data-state='active']",
      "[data-slot='toggle-group-item'][data-state='on']",
      "[data-slot='toggle'][data-state='on']",
    ])
      expect(block).toContain(sel);
    expect(block).toMatch(/background: SelectedItem;\s*color: SelectedItemText;/);
  });
});

describe('forced colors, progress', () => {
  it('draws a progress bar’s track and fill in system colors, which forced colors would blank', async () => {
    const block = await forcedBlock();
    expect(block).toMatch(/\[data-slot='progress'\]\s*\{\s*outline: 1px solid CanvasText;/);
    expect(block).toMatch(
      /\[data-slot='progress-indicator'\]\s*\{\s*forced-color-adjust: none;\s*background: Highlight;/,
    );
  });
});

describe('toasts', () => {
  it('ring a focused toast and its action with the app ring, not sonner’s faint shadow', async () => {
    expect(await css()).toMatch(
      /\[data-sonner-toaster\] \[data-sonner-toast\]:focus-visible,\s*\[data-sonner-toaster\] \[data-sonner-toast\]\[data-styled\] \[data-button\]:focus-visible\s*\{\s*box-shadow: none;\s*outline: 2px solid var\(--ring\);/,
    );
  });
});

describe('forced colors, focus', () => {
  it('gives every focused element a system outline in forced colors mode', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const css = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{\s*outline: 2px solid CanvasText !important;/,
    );
  });
});

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
  });
});

describe('forced colors', () => {
  it('gives every focused element a system outline in forced colors mode', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const css = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{\s*outline: 2px solid CanvasText !important;/,
    );
  });
});

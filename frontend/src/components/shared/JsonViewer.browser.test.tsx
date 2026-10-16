import '@/index.css';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { domMax } from 'motion/react';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { CodeBlock } from './CodeBlock';
import { JsonViewer } from './JsonViewer';

// vitest/browser drives the real keyboard. its types redeclare jest-dom's
// matchers for the whole project, so it is loaded by a specifier typescript
// does not follow, typed with only what this file uses
interface BrowserContext {
  userEvent: { keyboard(text: string): Promise<void>; tab(): Promise<void> };
}
const browser = () => import('vitest/browser' as string) as Promise<BrowserContext>;

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const payload = {
  id: 'evt_1',
  data: { duration_ms: 30000, public: true, thumbnail: null, title: 'x'.repeat(400) },
};

function show() {
  return render(
    <MotionProvider features={domMax}>
      <div style={{ width: 320 }}>
        <JsonViewer value={payload} label="Payload" />
        <CodeBlock code="const a = 1;" language="ts" label="snippet" />
      </div>
    </MotionProvider>,
  );
}

const color = (el: Element) => getComputedStyle(el).color;
const background = (el: Element) => getComputedStyle(el).backgroundColor;

describe('JsonViewer in a real browser', () => {
  it('takes its colors from the theme, light and dark', () => {
    const { container } = show();
    const viewer = container.querySelector('[data-slot="json-viewer"]')!;
    const code = container.querySelector('[data-slot="code-block"]')!;
    const light = {
      key: color(screen.getByText('"duration_ms"')),
      string: color(screen.getByText('"evt_1"')),
      number: color(screen.getByText('30000')),
      boolean: color(screen.getByText('true')),
      surface: background(viewer),
      code: background(code),
    };
    expect(light).toEqual({
      key: 'rgb(15, 107, 122)',
      string: 'rgb(47, 107, 30)',
      number: 'rgb(180, 83, 9)',
      boolean: 'rgb(160, 48, 107)',
      surface: 'rgb(255, 255, 255)',
      code: 'rgb(255, 255, 255)',
    });

    document.documentElement.classList.add('dark');
    expect({
      key: color(screen.getByText('"duration_ms"')),
      string: color(screen.getByText('"evt_1"')),
      number: color(screen.getByText('30000')),
      boolean: color(screen.getByText('true')),
      surface: background(viewer),
      code: background(code),
    }).toEqual({
      // keys are the accent, as on the board, in both themes
      key: 'rgb(91, 191, 204)',
      string: 'rgb(167, 217, 138)',
      number: 'rgb(245, 183, 107)',
      boolean: 'rgb(240, 160, 200)',
      surface: 'rgb(20, 23, 26)',
      code: 'rgb(20, 23, 26)',
    });
  });

  it('wraps a long string instead of scrolling the page sideways', () => {
    const { container } = show();
    const viewer = container.querySelector<HTMLElement>('[data-slot="json-viewer"]')!;
    expect(viewer.scrollWidth).toBeLessThanOrEqual(viewer.clientWidth);
    expect(screen.getByText(`"${'x'.repeat(400)}"`).getBoundingClientRect().height).toBeGreaterThan(
      40,
    );
  });

  it('rings the line of the item the keyboard is on, not its whole branch', async () => {
    show();
    const { userEvent } = await browser();
    // start from the copy button: webkit's tab skips buttons, but not the tree
    screen.getByRole('button', { name: 'Copy JSON of Payload' }).focus();
    await userEvent.tab();
    const root = screen.getByRole('treeitem', { name: 'Payload, 2 keys' });
    expect(document.activeElement).toBe(root);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const data = screen.getByRole('treeitem', { name: 'data, 4 keys' });
    expect(document.activeElement).toBe(data);
    const line = data.querySelector('[data-line]')!;
    expect(getComputedStyle(line).boxShadow).not.toBe('none');
    expect(getComputedStyle(root.querySelector('[data-line]')!).boxShadow).toBe('none');
    // the twisty is the board's triangle, and its colour eases on hover
    const caret = data.querySelector('button')!;
    expect(caret.textContent).toBe('▾');
    expect(getComputedStyle(caret).transitionDuration).toBe('0.15s');
    await userEvent.keyboard('{ArrowLeft}');
    expect(data).toHaveAttribute('aria-expanded', 'false');
  });
});

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { CodeBlock } from './CodeBlock';

describe('CodeBlock', () => {
  it('highlights a single snippet and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = renderWithMotion(
      <CodeBlock code={"const a = 'b';"} language="ts" label="snippet" />,
    );
    expect(container.querySelector('.text-code-keyword')).toHaveTextContent('const');
    expect(container.querySelector('pre')).toHaveTextContent("const a = 'b';");
    await act(async () => screen.getByRole('button', { name: 'Copy snippet' }).click());
    expect(writeText).toHaveBeenCalledWith("const a = 'b';");
  });

  it('switches languages with tabs and copies the shown one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithMotion(
      <CodeBlock
        label="upload snippet"
        samples={[
          { label: 'JavaScript', language: 'ts', code: 'await sluby.upload(file)' },
          { label: 'curl', language: 'bash', code: 'curl -X POST $URL' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'curl' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('curl -X POST $URL');
    await act(async () =>
      screen.getByRole('button', { name: 'Copy upload snippet (curl)' }).click(),
    );
    expect(writeText).toHaveBeenCalledWith('curl -X POST $URL');
  });

  it('is one tab stop after the copy button, the scrolling code, not its panel too', async () => {
    renderWithMotion(
      <CodeBlock
        label="upload snippet"
        samples={[
          { label: 'JavaScript', language: 'ts', code: 'await sluby.upload(file)' },
          { label: 'curl', language: 'bash', code: 'curl -X POST $URL' },
        ]}
      />,
    );
    screen.getByRole('button', { name: 'Copy upload snippet (JavaScript)' }).focus();
    await userEvent.tab();
    expect(document.activeElement?.tagName).toBe('PRE');
  });

  it('shows code without ligatures, so !== and => read as typed', () => {
    renderWithMotion(<CodeBlock code="a !== b => c" language="ts" label="snippet" />);
    expect(screen.getByText(/!==/).closest('pre')!.className).toContain(
      '[font-variant-ligatures:none]',
    );
  });

  it('is a named region the keyboard can scroll, in every browser (A11Y-19)', () => {
    renderWithMotion(<CodeBlock code="npm i @sluby/sdk" language="bash" label="install command" />);
    const region = screen.getByRole('region', { name: 'install command code' });
    expect(region.tagName).toBe('PRE');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('names its language tabs', () => {
    renderWithMotion(
      <CodeBlock
        label="setup snippet"
        tabsLabel="Snippet language"
        samples={[
          { label: 'JavaScript', language: 'ts', code: 'a' },
          { label: 'curl', language: 'bash', code: 'b' },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Snippet language' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'setup snippet code' })).toHaveTextContent('a');
  });

  it('reports a copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const onCopied = vi.fn();
    renderWithMotion(<CodeBlock code="x" label="secret" onCopied={onCopied} />);
    await act(async () => screen.getByRole('button', { name: 'Copy secret' }).click());
    expect(onCopied).toHaveBeenCalledTimes(1);
  });
});

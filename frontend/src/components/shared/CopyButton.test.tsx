import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  it('copies the value and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value="abc" />);

    await act(async () => screen.getByRole('button').click());

    expect(writeText).toHaveBeenCalledWith('abc');
    // announced through a live region; the button keeps its name
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(screen.getByRole('button')).toHaveAccessibleName('Copy to clipboard');
  });

  it('reports a failed copy instead of claiming success', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CopyButton value="abc" />);

    await act(async () => screen.getByRole('button').click());

    expect(screen.getByRole('status')).toHaveTextContent('Copy failed: clipboard unavailable');
  });

  it('says Copied on the button when it shows text', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<CopyButton value="abc" label="Copy API key" withText />);
    expect(screen.getByRole('button')).toHaveTextContent('Copy');
    await act(async () => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('Copied');
    expect(screen.getByRole('button')).toHaveAccessibleName('Copy API key');
  });
});

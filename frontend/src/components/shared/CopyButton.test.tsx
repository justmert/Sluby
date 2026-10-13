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
    expect(screen.getByRole('button')).toHaveAccessibleName('Copied');
  });

  it('reports a failed copy instead of claiming success', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<CopyButton value="abc" />);

    await act(async () => screen.getByRole('button').click());

    expect(screen.getByRole('button')).toHaveAccessibleName('Copy failed');
  });
});

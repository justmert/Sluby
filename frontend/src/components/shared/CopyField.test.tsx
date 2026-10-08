import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { CopyField } from './CopyField';

describe('CopyField', () => {
  it('shortens a long id and keeps the full value in a tooltip and the copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithMotion(
      <CopyField label="video ID" value="0123456789abcdef0123456789" truncate={6} />,
    );
    expect(screen.getByText('012345…456789')).toHaveAttribute(
      'title',
      '0123456789abcdef0123456789',
    );
    await act(async () => screen.getByRole('button', { name: 'Copy video ID' }).click());
    expect(writeText).toHaveBeenCalledWith('0123456789abcdef0123456789');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('masks a secret until revealed', async () => {
    renderWithMotion(<CopyField label="API key" value="sluby_secret_value" secret />);
    expect(screen.queryByText('sluby_secret_value')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByText('sluby_secret_value')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide API key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

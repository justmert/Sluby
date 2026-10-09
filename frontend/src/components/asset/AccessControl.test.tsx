import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccessTier } from '@sluby/sdk';
import { ConflictError } from '@sluby/sdk';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { AccessControl } from './AccessControl';

function Harness({ onChange }: { onChange: (t: AccessTier) => Promise<unknown> }) {
  const [value, setValue] = useState<AccessTier>('public');
  return (
    <AccessControl
      value={value}
      onChange={async (next) => {
        await onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('AccessControl', () => {
  it('asks before making a video private, then saves and returns focus to the control', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    renderPage(<Harness onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Who can watch' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Private' }));

    const dialog = await screen.findByRole('dialog', { name: 'Make this video private?' });
    expect(dialog).toHaveAccessibleDescription(
      'Players without a signed URL stop working within a minute. Viewers who already have a link keep it until it expires.',
    );
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));

    expect(onChange).toHaveBeenCalledWith('private');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(group).getByRole('radio', { name: 'Private' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Private' })).toHaveFocus(),
    );
  });

  it('asks before making a video public too', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    renderPage(<AccessControl value="private" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Public' }));
    const dialog = await screen.findByRole('dialog', { name: 'Make this video public?' });
    expect(within(dialog).getByText('Anyone with the stream URL can play it.')).toBeInTheDocument();
  });

  it('changes nothing on Cancel and keeps focus on the control', async () => {
    const onChange = vi.fn();
    renderPage(<AccessControl value="public" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Public' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Public' })).toHaveFocus());
  });

  it('keeps the confirm open with the reason when saving fails', async () => {
    const onChange = vi
      .fn()
      .mockRejectedValue(new ConflictError('This video was changed somewhere else.'));
    renderPage(<AccessControl value="public" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This video was changed somewhere else.',
    );
    // the page behind a modal popover is hidden from the accessibility tree
    expect(screen.getByRole('radio', { name: 'Public', hidden: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('does nothing when the selected option is pressed again', async () => {
    renderPage(<AccessControl value="public" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Public' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Public' })).toHaveAttribute('aria-checked', 'true');
  });
});

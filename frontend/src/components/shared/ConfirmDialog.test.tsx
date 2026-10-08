import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
import { ConfirmDialog } from './ConfirmDialog';

function Harness({ onConfirm, typed }: { onConfirm: () => unknown; typed?: string }) {
  const [item, setItem] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setItem('Product walkthrough')}>Delete</button>
      <ConfirmDialog
        item={item}
        onClose={() => setItem(null)}
        title="Delete this video?"
        description={(name) => <>“{name}” is removed. This cannot be undone.</>}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the video"
        typedConfirmation={typed}
        onConfirm={onConfirm}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('stays open and busy until the action settles, then closes', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    renderWithMotion(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this video?' });
    expect(dialog).toHaveTextContent('“Product walkthrough” is removed.');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('shows the error inside and keeps the dialog open on failure', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    renderWithMotion(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not delete the video');
    expect(alert).toHaveTextContent('The server ran into a problem (error 500).');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('keeps its text while it closes, after the page cleared the item', async () => {
    const onConfirm = vi.fn();
    renderWithMotion(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledWith('Product walkthrough');
  });

  it('uses the solid destructive button', async () => {
    renderWithMotion(<Harness onConfirm={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
  });

  it('needs the typed confirmation before it confirms', async () => {
    const onConfirm = vi.fn();
    renderWithMotion(<Harness onConfirm={onConfirm} typed="delete 12 videos" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'delete 12 video');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 's');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

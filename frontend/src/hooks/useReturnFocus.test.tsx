import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

// a dialog opened from state, not from a DialogTrigger, like the studio's
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Edit video</DialogTitle>
          <DialogDescription>Change the title.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('dialog focus', () => {
  it('gives focus back to the opener when the dialog closes', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Edit' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });
});

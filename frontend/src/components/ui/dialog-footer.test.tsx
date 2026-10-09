import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertDialog, AlertDialogContent, AlertDialogFooter } from './alert-dialog';
import { Dialog, DialogContent, DialogFooter } from './dialog';

// at 400% zoom a dialog is about 175 px tall; a footer stuck to its bottom
// covered the field that had focus, so it sticks only where there is room
describe('dialog footers on short screens', () => {
  it('stick only when the viewport is tall enough', () => {
    render(
      <>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogFooter>a</DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open>
          <AlertDialogContent aria-describedby={undefined}>
            <AlertDialogFooter>b</AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>,
    );
    const footers = document.querySelectorAll('[data-slot$=dialog-footer]');
    expect(footers).toHaveLength(2);
    for (const f of footers) {
      expect(f).toHaveClass('[@media(min-height:30rem)]:sticky');
      expect(f).not.toHaveClass('sticky');
    }
  });
});

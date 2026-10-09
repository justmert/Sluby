import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';

function Menu({ label }: { label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>{label} item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function render(page: React.ReactNode) {
  vi.stubGlobal(
    'fetch',
    jsonFetch({
      '/api/v1/system/status': () => new Promise(() => {}),
      '/api/v1/stats': () => new Promise(() => {}),
      '/api/v1/webhooks': { data: [] },
    }),
  );
  return renderPage(
    <WithSession>
      <AppShell>{page}</AppShell>
    </WithSession>,
    { route: '/studio/settings' },
  );
}

// axe "region": a portal at the end of body is outside every landmark
describe('where overlays portal', () => {
  it('puts a page menu and the top bar menu inside the main landmark', async () => {
    render(<Menu label="Row" />);
    await userEvent.click(screen.getByRole('button', { name: 'Row' }));
    const menu = await screen.findByRole('menu');
    expect(screen.getByRole('main')).toContainElement(menu);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /alice/ }));
    expect(screen.getByRole('main')).toContainElement(await screen.findByRole('menu'));
    vi.unstubAllGlobals();
  });

  it('puts a page popover inside the main landmark', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Details</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="More details">Inside</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    const popover = await screen.findByRole('dialog', { name: 'More details' });
    expect(screen.getByRole('main')).toContainElement(popover);
    vi.unstubAllGlobals();
  });

  it('puts a menu opened inside a dialog on body after the dialog, not behind it', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Edit</DialogTitle>
          <Menu label="Inner" />
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Inner' }));
    const menu = await screen.findByRole('menu');
    // the dialog hides main from the accessibility tree, so look it up directly
    expect(document.querySelector('main')).not.toContainElement(menu);
    expect(dialog.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

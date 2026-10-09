import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AppShell } from './AppShell';

function renderShell(route = '/studio') {
  return renderPage(
    <WithSession>
      <AppShell>
        <p>Page body</p>
      </AppShell>
    </WithSession>,
    { route },
  );
}

// jsdom has no layout, so a viewport width is a matchMedia answer
function viewport(width: number) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches =
      (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('AppShell', () => {
  it('lets the content column shrink below a wide table instead of scrolling the page', () => {
    const { container } = renderShell();
    const inset = container.querySelector('[data-slot="sidebar-inset"]');
    // a flex child keeps its content's min width unless told otherwise
    expect(inset).toHaveClass('min-w-0');
    expect(screen.getByRole('main')).toHaveClass('overflow-x-clip');
  });

  it('starts with a skip link that moves focus to the page', async () => {
    renderShell();
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    await userEvent.click(skip);
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives focus back to the menu button when the phone sidebar closes', async () => {
    viewport(390);
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Show or hide sidebar' });
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    const sheet = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(sheet).getByRole('link', { name: 'Videos' })).toBeInTheDocument();
    // one Escape closes it, with focus on the current page's link (A11Y-41)
    expect(within(sheet).getByRole('link', { name: 'Overview' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toggle).toHaveFocus();
  });

  it('opens the sidebar on wide screens and starts it as an icon rail on tablets', () => {
    viewport(1440);
    const wide = renderShell();
    expect(wide.container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'expanded',
    );
    wide.unmount();

    viewport(1024);
    const tablet = renderShell();
    expect(tablet.container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'collapsed',
    );
  });

  it('keeps a sidebar the user opened on a tablet open', async () => {
    viewport(1024);
    const { container } = renderShell();
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Show or hide sidebar' }),
    );
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-state',
      'expanded',
    );
  });

  it('names the browser tab after the page', () => {
    renderShell('/studio/videos');
    expect(document.title).toBe('Videos · Sluby Studio');
  });

  it('names the overview tab and an unknown page', () => {
    const view = renderShell('/studio');
    expect(document.title).toBe('Overview · Sluby Studio');
    view.unmount();
    renderShell('/studio/nope');
    expect(document.title).toBe('Not found · Sluby Studio');
  });

  it('names a video tab by the title the page loaded', async () => {
    const { client } = renderShell('/studio/videos/a1');
    expect(document.title).toBe('Video · Sluby Studio');
    client.setQueryData(['assets', 'one', 'a1'], { id: 'a1', title: 'Keynote 2026' });
    await vi.waitFor(() => expect(document.title).toBe('Keynote 2026 · Sluby Studio'));
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { TopBar } from './TopBar';

function renderAt(route: string, seed?: (c: ReturnType<typeof renderPage>['client']) => void) {
  const view = renderPage(
    <ThemeProvider>
      <WithSession>
        <SidebarProvider>
          <TopBar />
        </SidebarProvider>
      </WithSession>
    </ThemeProvider>,
    { route },
  );
  if (seed) seed(view.client);
  return view;
}

describe('TopBar', () => {
  it('names the asset page by the title the page loaded', async () => {
    renderAt('/studio/videos/a1', (client) =>
      client.setQueryData(['assets', 'one', 'a1'], { id: 'a1', title: 'Keynote 2026' }),
    );
    expect(await screen.findByText('Keynote 2026')).toBeInTheDocument();
    expect(screen.queryByText('a1')).not.toBeInTheDocument();
  });

  it('says not found for an unknown section', () => {
    renderAt('/studio/nope/deeper');
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.queryByText('nope')).not.toBeInTheDocument();
  });

  it('is a sticky 60px surface bar, with the current page in bold', () => {
    renderAt('/studio/developers/keys');
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', 'top-0', 'h-15', 'border-b', 'bg-card');
    expect(screen.getByText('API keys')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('API keys')).toHaveClass('font-semibold');
  });

  it('shows the menu button only below 900px', () => {
    renderAt('/studio');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass('min-[900px]:hidden');
  });

  it('has a square upload button, only on a phone, and moves theme and account into the sheet there', () => {
    renderAt('/studio/videos');
    const upload = screen.getByRole('link', { name: 'Upload video' });
    expect(upload).toHaveAttribute('href', '/studio/videos/upload');
    expect(upload).toHaveClass('sm:hidden', 'size-11');
    expect(screen.getByRole('button', { name: /^Switch to/ })).toHaveClass('max-sm:hidden');
    expect(screen.getByRole('button', { name: /^Account menu/ })).toHaveClass('max-sm:hidden');
  });

  it('keeps the trail on one line on phones: only the page name, with a back link', () => {
    const { container } = renderAt('/studio/videos/a1', (client) =>
      client.setQueryData(['assets', 'one', 'a1'], { id: 'a1', title: 'Keynote 2026' }),
    );
    const list = container.querySelector('[data-slot="breadcrumb-list"]');
    expect(list).toHaveClass('flex-nowrap');
    // the parent crumbs and their separators only show from sm up
    for (const el of container.querySelectorAll(
      '[data-slot="breadcrumb-item"]:not(:last-child), [data-slot="breadcrumb-separator"]',
    )) {
      expect(el).toHaveClass('max-sm:hidden');
    }
    const back = screen.getByRole('link', { name: 'Back to Videos' });
    expect(back).toHaveAttribute('href', '/studio/videos');
    expect(back).toHaveClass('sm:hidden');
  });

  it('wraps to a second row when large text needs it, and pads the page by its real height (1.4.4, 2.4.11)', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(112);
    const { unmount } = renderAt('/studio/videos');
    const header = screen.getByRole('banner');
    expect(header).toHaveClass(
      'max-[24rem]:flex-wrap',
      'max-[24rem]:h-auto',
      'max-[24rem]:min-h-14',
    );
    expect(document.documentElement.style.getPropertyValue('--top-bar-h')).toBe('112px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--top-bar-h')).toBe('');
    vi.restoreAllMocks();
  });

  it('has no back link on a top level page', () => {
    renderAt('/studio/settings');
    expect(screen.queryByRole('link', { name: /^back to/i })).not.toBeInTheDocument();
  });
});

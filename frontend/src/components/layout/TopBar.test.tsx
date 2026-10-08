import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    renderAt('/studio/assets/a1', (client) =>
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

  it('centers the short divider by the sidebar toggle instead of stretching it', () => {
    const { container } = renderAt('/studio');
    const divider = container.querySelector('header [data-slot="separator"]');
    expect(divider).toHaveAttribute('data-orientation', 'vertical');
    // a stretched item with a fixed height sits at the top of the bar, not in the middle
    expect(divider?.className).not.toMatch(/self-stretch/);
    expect(divider?.className).toMatch(/data-vertical:self-auto/);
  });

  it('keeps the trail on one line on phones: only the page name, with a back link', () => {
    const { container } = renderAt('/studio/assets/a1', (client) =>
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
    expect(back).toHaveAttribute('href', '/studio/assets');
    expect(back).toHaveClass('sm:hidden');
  });

  it('has no back link on a top level page', () => {
    renderAt('/studio/settings');
    expect(screen.queryByRole('link', { name: /^back to/i })).not.toBeInTheDocument();
  });
});

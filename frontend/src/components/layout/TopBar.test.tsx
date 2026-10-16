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
});

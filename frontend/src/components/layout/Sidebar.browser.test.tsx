import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { domMax } from 'motion/react';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { ThemeProvider } from '@/components/theme-provider';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WithSession } from '@/test/session';
import { AppSidebar } from './Sidebar';

// vitest/browser drives the real keyboard. its types redeclare jest-dom's
// matchers for the whole project, so it is loaded by a specifier typescript
// does not follow, typed with only what this file uses
interface BrowserContext {
  page: { viewport(width: number, height: number): Promise<void> };
  userEvent: { keyboard(text: string): Promise<void> };
}
const browser = () => import('vitest/browser' as string) as Promise<BrowserContext>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

beforeEach(async () => {
  await (await browser()).page.viewport(390, 844);
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/webhooks')) return Promise.resolve(json({ data: [] }));
    // status and stats never answer; the sheet does not need them
    return new Promise<Response>(() => {});
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A11Y-41 with a real keyboard: Enter opens the phone sheet, focus lands on
// the current page's link, and that same Enter does not follow the link
describe('the phone navigation sheet, in a real browser', () => {
  it.each(['Enter', 'Space'])(
    'opens with %s onto the current link without following it',
    async (key) => {
      render(
        <ThemeProvider>
          <MotionProvider features={domMax}>
            <QueryClientProvider client={new QueryClient()}>
              <TooltipProvider>
                <MemoryRouter initialEntries={['/studio/videos']}>
                  <WithSession>
                    <SidebarProvider>
                      <SidebarTrigger />
                      <AppSidebar />
                      <Where />
                    </SidebarProvider>
                  </WithSession>
                </MemoryRouter>
              </TooltipProvider>
            </QueryClientProvider>
          </MotionProvider>
        </ThemeProvider>,
      );
      screen.getByRole('button', { name: 'Open menu' }).focus();
      await (await browser()).userEvent.keyboard(key === 'Space' ? ' ' : '{Enter}');
      const sheet = await screen.findByRole('dialog', { name: 'Navigation' });
      await waitFor(() =>
        expect(within(sheet).getByRole('link', { name: 'Videos' })).toHaveFocus(),
      );
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos');
      expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
      // one Escape closes it
      await (await browser()).userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    },
  );
});

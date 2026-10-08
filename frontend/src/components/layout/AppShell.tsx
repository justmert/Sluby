import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useIsWide } from '@/hooks/use-mobile';
import { AppSidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { routeTitle, useRouteCrumbs } from './use-route-crumbs';

const MAIN_ID = 'main-content';

function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      // focus the page without a hash in the url, which the router would keep
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(MAIN_ID)?.focus();
      }}
      className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:px-3 focus:py-2 focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to content
    </a>
  );
}

/**
 * The sidebar is open on wide screens and an icon rail below that, so a
 * tablet keeps room for the page. A toggle sticks until the window crosses
 * the breakpoint, then the default for the new width applies again.
 */
function useSidebarOpen() {
  const wide = useIsWide();
  const [choice, setChoice] = useState<{ wide: boolean; open: boolean } | null>(null);
  const open = choice && choice.wide === wide ? choice.open : wide;
  return [open, (next: boolean) => setChoice({ wide, open: next })] as const;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useSidebarOpen();
  const title = routeTitle(useRouteCrumbs());

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <SkipLink />
      <AppSidebar />
      {/* a div rather than the ui SidebarInset, which is a <main>: the page
          area below is the one main landmark, and the top bar stays a banner.
          min-w-0 lets this flex child shrink below a wide table, so the table
          scrolls in its card instead of the whole page scrolling sideways */}
      <div
        data-slot="sidebar-inset"
        className="relative flex w-full min-w-0 flex-1 flex-col bg-background"
      >
        <TopBar />
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 overflow-x-clip outline-none">
          <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </SidebarProvider>
  );
}

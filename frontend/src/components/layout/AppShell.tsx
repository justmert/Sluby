import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { PortalContainerProvider } from '@/components/ui/portal-container';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthOffBanner } from './AuthOffBanner';
import { LiveAlerts } from './LiveAlerts';
import { OfflineBanner } from './OfflineBanner';
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const title = routeTitle(useRouteCrumbs());
  // menus, selects and tooltips portal into the main landmark (ui/portal-container)
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // after a navigation, focus moves to the new page, so the next Tab starts
  // there instead of back at the skip link. a sidebar link keeps its focus,
  // and so does a field or button the new page focused itself as it mounted
  // (the upload page starts on Choose files). the old page is gone by now,
  // so focus inside a page container is the new page's own
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active.isConnected &&
      (active.closest('[data-sidebar=sidebar]') || active.closest('[data-slot=page-container]'))
    ) {
      return;
    }
    document.getElementById(MAIN_ID)?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <PortalContainerProvider container={overlayRoot}>
      <SidebarProvider>
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
          <AuthOffBanner />
          <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 overflow-x-clip outline-none">
            <OfflineBanner />
            <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
            {/* outside the page, so a route change never unmounts an open menu's host */}
            <div ref={setOverlayRoot} data-slot="overlay-root" />
          </main>
        </div>
        <LiveAlerts />
      </SidebarProvider>
    </PortalContainerProvider>
  );
}

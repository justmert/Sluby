import { Fragment, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UploadIndicator } from './UploadIndicator';
import { UserMenu } from './UserMenu';
import { useRouteCrumbs } from './use-route-crumbs';

function subscribeToScroll(onChange: () => void) {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}

// the bar only draws its edge once content passes under it
const useScrolled = () =>
  useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 0,
    () => false,
  );

export function TopBar() {
  const crumbs = useRouteCrumbs();
  const scrolled = useScrolled();
  // phones show only the page's own name; a detail page gets a way up instead
  const parent = crumbs.length > 2 ? crumbs[crumbs.length - 2] : undefined;

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur transition-[border-color] duration-150 data-[scrolled=false]:border-transparent"
    >
      <SidebarTrigger className="-ml-1" />
      {/* the base separator stretches to the row; a fixed height has to drop that or it pins to the top */}
      <Separator
        orientation="vertical"
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
      />
      {parent?.path && (
        <Button variant="ghost" size="icon-sm" className="-ml-1 sm:hidden" asChild>
          <Link to={parent.path} aria-label={`Back to ${parent.label}`}>
            <ChevronLeft />
          </Link>
        </Button>
      )}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && <BreadcrumbSeparator className="max-sm:hidden" />}
                <BreadcrumbItem className={last ? 'min-w-0' : 'shrink-0 max-sm:hidden'}>
                  {last || !crumb.path ? (
                    <BreadcrumbPage className="truncate" title={crumb.label}>
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.path}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex shrink-0 items-center gap-1">
        <UploadIndicator />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

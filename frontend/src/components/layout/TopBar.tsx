import { Fragment, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { isNavActive, NAV_GROUPS, ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { preloadPage } from '@/lib/page-chunks';
import { CommandPalette } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';
import { UploadIndicator } from './UploadIndicator';
import { UserMenu } from './UserMenu';
import { useRouteCrumbs } from './use-route-crumbs';

/**
 * The design's header, sticky over every page: the breadcrumb, search with
 * its label and ⌘K, the theme switch and the account. Below 900px the menu
 * button opens the sidebar and search shrinks to its icon. On a phone it is
 * the phone board's header: the menu, the page's name in bold, search and a
 * square upload button; the theme and the account move into the menu sheet.
 */
export function TopBar() {
  const crumbs = useRouteCrumbs();
  // phones show only the page's own name; a detail page gets a way up instead
  const parent = crumbs.length > 2 ? crumbs[crumbs.length - 2] : undefined;
  const { pathname } = useLocation();
  const adminPage = NAV_GROUPS.some((g) =>
    g.items.some(
      (item) => (g.adminOnly || item.adminOnly) && isNavActive({ ...item, exact: false }, pathname),
    ),
  );

  // the page's top scroll padding (index.css) follows the bar's height, which
  // grows to two rows when a large default font makes it wrap (1.4.4)
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--top-bar-h', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--top-bar-h');
    };
  }, []);

  return (
    <header
      ref={bar}
      className="sticky top-0 z-20 flex h-15 shrink-0 items-center gap-2 border-b bg-card px-8 max-[899px]:px-3 max-sm:h-14 max-sm:gap-1 max-sm:px-1.5 max-[24rem]:h-auto max-[24rem]:min-h-14 max-[24rem]:flex-wrap max-[24rem]:py-2"
    >
      <SidebarTrigger className="min-[900px]:hidden" />
      {parent?.path && (
        <Button variant="ghost" size="icon" className="sm:hidden" asChild>
          <Link to={parent.path} aria-label={`Back to ${parent.label}`}>
            <ChevronLeft />
          </Link>
        </Button>
      )}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-2 text-sm sm:gap-2">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && <BreadcrumbSeparator className="max-sm:hidden" />}
                <BreadcrumbItem className={last ? 'min-w-0' : 'shrink-0 max-sm:hidden'}>
                  {last || !crumb.path ? (
                    // a video title can be right to left; dir keeps its start in view when it truncates
                    <BreadcrumbPage
                      dir="auto"
                      className="truncate font-semibold max-sm:text-base max-sm:font-bold"
                      title={crumb.label}
                    >
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.path} dir="auto">
                        {crumb.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {/* the health board's chip: a page members never see */}
      {adminPage && <Badge className="ml-1 shrink-0 max-sm:hidden">Admins only</Badge>}
      {/* on a second row, when the bar wraps, it keeps to the right */}
      <div className="ml-auto flex min-w-0 shrink items-center justify-end gap-2 max-sm:gap-1">
        <UploadIndicator />
        <CommandPalette className="max-sm:size-11 max-sm:border-transparent max-sm:bg-transparent max-sm:text-secondary-foreground max-sm:hover:bg-muted" />
        <ThemeToggle className="max-sm:hidden" />
        <UserMenu className="max-sm:hidden" />
        <Button size="icon-lg" className="sm:hidden" asChild>
          <Link
            to={ROUTES.UPLOAD}
            aria-label="Upload video"
            onPointerEnter={() => preloadPage(ROUTES.UPLOAD)}
            onFocus={() => preloadPage(ROUTES.UPLOAD)}
          >
            <Icons.upload className="size-5" />
          </Link>
        </Button>
      </div>
    </header>
  );
}

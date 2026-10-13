import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from './UserMenu';

const SECTION_LABELS: Record<string, string> = {
  upload: 'Upload',
  assets: 'Assets',
  player: 'Player',
  developer: 'Developer',
  analytics: 'Analytics',
  settings: 'Settings',
};

export function getBreadcrumbs(pathname: string): Array<{ label: string; path?: string }> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'studio') return [];
  const crumbs: Array<{ label: string; path?: string }> = [{ label: 'Studio', path: '/studio' }];
  if (segments[1]) {
    crumbs.push({
      label: SECTION_LABELS[segments[1]] ?? segments[1],
      path: `/studio/${segments[1]}`,
    });
    if (segments[2] && segments[1] === 'assets') crumbs.push({ label: segments[2] });
  }
  return crumbs;
}

export function TopBar() {
  const { pathname } = useLocation();
  const crumbs = getBreadcrumbs(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {last || !crumb.path ? (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
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
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

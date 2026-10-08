import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { VideoAsset } from '@sluby/sdk';
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
import { getBreadcrumbs } from './breadcrumbs';
import { UserMenu } from './UserMenu';

export function TopBar() {
  const { pathname } = useLocation();
  const assetId = /^\/studio\/assets\/([^/]+)\/?$/.exec(pathname)?.[1];
  // read whatever the asset page loaded; the crumb never fetches on its own
  const asset = useQuery<VideoAsset>({ queryKey: ['assets', 'one', assetId], enabled: false });
  const crumbs = getBreadcrumbs(pathname, assetId ? asset.data?.title : undefined);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      {/* the base separator stretches to the row; a fixed height has to drop that or it pins to the top */}
      <Separator
        orientation="vertical"
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
      />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
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
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}

import { NavLink, useLocation } from 'react-router';
import * as m from 'motion/react-m';
import { ArrowUpRight, FileText } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Logo } from '@/components/brand/Logo';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { isNavActive, LINKS, navGroupsFor, ROUTES, type NavItem } from '@/lib/constants';
import { errorText } from '@/lib/errors';
import { NO_VALUE } from '@/lib/formatters';
import { spring } from '@/lib/motion';
import { preloadPage } from '@/lib/page-chunks';
import { useSession } from '@/lib/session';
import { NavSignalMark } from './NavHealthDot';
import { useNavSignals, type NavSignal } from './nav-signals';

export function AppSidebar() {
  const { pathname } = useLocation();
  const { operator } = useSession();
  const groups = navGroupsFor(operator);
  const signals = useNavSignals(operator);
  // on mobile the sidebar is a sheet over the page; picking a page should
  // close it rather than leave it covering what was just opened
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      {/* the nav landmark holds the whole sidebar, logo and footer too, so
          nothing in it sits outside a landmark */}
      <nav aria-label="Studio" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <NavLink to={ROUTES.OVERVIEW} onClick={closeMobile}>
                  {/* the menu button sizes every svg inside it to 16px; the mark keeps its 32 */}
                  <Logo className="size-8!" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-heading font-semibold">Sluby</span>
                    <span className="truncate text-xs text-muted-foreground">Studio</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <div className="flex flex-1 flex-col">
            {groups.map((group) => {
              const labelId = group.label ? `nav-group-${group.id}` : undefined;
              return (
                <SidebarGroup
                  key={group.id}
                  role={labelId ? 'group' : undefined}
                  aria-labelledby={labelId}
                  // settings sits at the bottom, apart from the work pages
                  className={group.id === 'settings' ? 'mt-auto border-t' : undefined}
                >
                  {group.label && (
                    <SidebarGroupLabel id={labelId} className="gap-2">
                      {group.label}
                      {group.operatorOnly && (
                        <>
                          <Badge
                            variant="outline"
                            aria-hidden="true"
                            className="h-4 px-1.5 text-kbd"
                          >
                            Operator
                          </Badge>
                          <span className="sr-only">, operators only</span>
                        </>
                      )}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <NavEntry
                          key={item.path}
                          item={item}
                          signal={signals[item.path]}
                          active={isNavActive(item, pathname)}
                          pathname={pathname}
                          onNavigate={closeMobile}
                        />
                      ))}
                      {group.id === 'settings' && (
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild tooltip="API reference, opens in a new tab">
                            <a href={LINKS.API_REFERENCE} target="_blank" rel="noopener noreferrer">
                              <FileText />
                              <span className="min-w-0 flex-1 truncate">API reference</span>
                              <ArrowUpRight
                                aria-hidden="true"
                                className="text-muted-foreground group-data-[collapsible=icon]:hidden"
                              />
                              <span className="sr-only">, opens in a new tab</span>
                            </a>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </div>
        </SidebarContent>
        <SidebarFooter className="pt-0">
          <VersionLine />
        </SidebarFooter>
      </nav>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * "v0.2.0 · mainnet": which server this is and which Sia network it stores
 * on. When the status call fails it reads an en dash, and the reason is in
 * its tooltip instead of a silent blank.
 */
function VersionLine() {
  const status = useSystemStatus({ poll: true });
  const line =
    'px-2 text-xs text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden';
  if (status.data) {
    return (
      <p className={line}>
        v{status.data.version} · {status.data.indexer.network}
      </p>
    );
  }
  if (status.isError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`${line} w-fit rounded-sm text-left`}
            aria-label={`Server version unavailable. ${errorText(status.error)}`}
          >
            {NO_VALUE}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64">
          {errorText(status.error)}
        </TooltipContent>
      </Tooltip>
    );
  }
  // keeps the footer's height while the first answer is on its way
  return (
    <p className={line} aria-hidden="true">
      &nbsp;
    </p>
  );
}

function NavEntry({
  item,
  signal,
  active,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  signal: NavSignal | undefined;
  active: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  const name = signal ? `${item.label}, ${signal.text}` : item.label;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={name}
        // the highlight is the sliding pill below, not the button's own background
        className="relative isolate data-active:bg-transparent data-active:hover:bg-sidebar-accent"
      >
        <NavLink
          to={item.path}
          // aria-current follows the pill: Quickstart is not current on API keys
          end={item.exact}
          onClick={onNavigate}
          // fetch the page's code while the pointer is on its way
          onPointerEnter={() => preloadPage(item.path)}
          onFocus={() => preloadPage(item.path)}
        >
          {active && (
            <m.span
              layoutId="sidebar-active"
              // measure only on navigation, so collapsing the sidebar does not slide it
              layoutDependency={pathname}
              transition={spring}
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent"
            />
          )}
          <item.icon />
          <span className="min-w-0 flex-1 truncate">
            {item.label}
            {signal && <span className="sr-only">, {signal.text}</span>}
          </span>
          {signal && <NavSignalMark signal={signal} />}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

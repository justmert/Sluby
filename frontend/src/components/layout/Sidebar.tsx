import { NavLink, useLocation } from 'react-router';
import * as m from 'motion/react-m';
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/Logo';
import { isNavActive, navGroupsFor, ROUTES, type NavItem } from '@/lib/constants';
import { Icons } from '@/lib/icons';
import { spring } from '@/lib/motion';
import { preloadPage } from '@/lib/page-chunks';
import { useSession } from '@/lib/session';
import { NavSignalMark } from './NavHealthDot';
import { useNavSignals, type NavSignal } from './nav-signals';

/**
 * The design's sidebar: the mark and name, the one primary action, the page
 * groups, and Settings on its own at the bottom. On wide screens it is a
 * column sticky at the window's full height; below 900px it hides and the
 * top bar's menu button opens it as a sheet. The server version and the API
 * reference live in the account menu.
 */
export function AppSidebar() {
  const { pathname } = useLocation();
  const { operator } = useSession();
  const groups = navGroupsFor(operator);
  const signals = useNavSignals(operator);
  // on a phone the sidebar is a sheet over the page; picking a page should
  // close it rather than leave it covering what was just opened
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);
  const work = groups.filter((g) => g.id !== 'settings');
  const settings = groups.find((g) => g.id === 'settings');

  const entries = (items: NavItem[]) => (
    <SidebarMenu className="gap-0.5">
      {items.map((item) => (
        <NavEntry
          key={item.path}
          item={item}
          signal={signals[item.path]}
          active={isNavActive(item, pathname)}
          pathname={pathname}
          onNavigate={closeMobile}
        />
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="none">
      {/* the nav landmark holds the whole sidebar, logo and settings too, so
          nothing in it sits outside a landmark */}
      <nav aria-label="Studio" className="flex min-h-0 flex-1 flex-col gap-6 px-3.5 py-5">
        <NavLink
          to={ROUTES.OVERVIEW}
          onClick={closeMobile}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1 text-foreground"
        >
          <Logo className="size-7" />
          <span className="text-[17px] font-bold tracking-[-0.01em]">Sluby Studio</span>
        </NavLink>
        {/* the studio's one primary action, on every page; NavLink marks it
            current on the upload page, and U opens it from anywhere */}
        <Button asChild>
          <NavLink
            to={ROUTES.UPLOAD}
            onClick={closeMobile}
            onPointerEnter={() => preloadPage(ROUTES.UPLOAD)}
            onFocus={() => preloadPage(ROUTES.UPLOAD)}
            aria-keyshortcuts="U"
          >
            <Icons.upload />
            Upload video
          </NavLink>
        </Button>
        <div className="flex flex-col gap-5">
          {work.map((group) => {
            const labelId = group.label ? `nav-group-${group.id}` : undefined;
            return (
              <SidebarGroup
                key={group.id}
                role={labelId ? 'group' : undefined}
                aria-labelledby={labelId}
                className="gap-0 p-0"
              >
                {group.label && (
                  <SidebarGroupLabel
                    id={labelId}
                    className="h-auto px-2.5 pt-0 pb-1.5 text-xs font-semibold text-subtle-foreground"
                  >
                    {group.label}
                    {group.operatorOnly && <span className="sr-only">, operators only</span>}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>{entries(group.items)}</SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </div>
        {/* settings sits at the bottom, apart from the work pages */}
        {settings && <div className="mt-auto">{entries(settings.items)}</div>}
      </nav>
    </Sidebar>
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

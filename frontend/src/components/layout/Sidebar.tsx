import { NavLink, useLocation } from 'react-router';
import * as m from 'motion/react-m';
import {
  Sidebar,
  SidebarContent,
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
import { Logo } from '@/components/brand/Logo';
import { isNavActive, navGroupsFor, ROUTES, type NavItem } from '@/lib/constants';
import { spring } from '@/lib/motion';
import { preloadPage } from '@/lib/page-chunks';
import { useSession } from '@/lib/session';

export function AppSidebar() {
  const { pathname } = useLocation();
  const { operator } = useSession();
  const groups = navGroupsFor(operator);
  // on mobile the sidebar is a sheet over the page; picking a page should
  // close it rather than leave it covering what was just opened
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
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
        {/* the nav landmark, so screen readers can jump to it */}
        <nav aria-label="Studio" className="flex flex-1 flex-col">
          {groups.map((group) => (
            <SidebarGroup
              key={group.id}
              // settings sits at the bottom, apart from the work pages
              className={group.id === 'settings' ? 'mt-auto' : undefined}
            >
              {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavEntry
                      key={item.path}
                      item={item}
                      active={isNavActive(item, pathname)}
                      pathname={pathname}
                      onNavigate={closeMobile}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function NavEntry({
  item,
  active,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
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
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

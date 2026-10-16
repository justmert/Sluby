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
import { STUDIO_NAV, ROUTES } from '@/lib/constants';
import { spring } from '@/lib/motion';
import { useSession } from '@/lib/session';

function isActive(pathname: string, path: string) {
  // the dashboard is the studio root, so only match it exactly
  if (path === ROUTES.STUDIO_DASHBOARD) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { operator } = useSession();
  const items = STUDIO_NAV.filter((item) => operator || !item.operatorOnly);
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
              <NavLink to={ROUTES.STUDIO_DASHBOARD} onClick={closeMobile}>
                <Logo />
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
        <SidebarGroup>
          <SidebarGroupLabel>Studio</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = isActive(pathname, item.path);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      // the highlight is the sliding pill below, not the button's own background
                      className="relative isolate data-active:bg-transparent data-active:hover:bg-sidebar-accent"
                    >
                      <NavLink to={item.path} onClick={closeMobile}>
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
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

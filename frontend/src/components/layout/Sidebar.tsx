import { NavLink, useLocation } from 'react-router';
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
              {items.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(pathname, item.path)}
                    tooltip={item.label}
                  >
                    <NavLink to={item.path} onClick={closeMobile}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

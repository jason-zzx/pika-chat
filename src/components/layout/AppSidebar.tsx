import AssistantTree from "@/components/assistant/AssistantTree";
import SidebarUserMenu from "@/components/layout/SidebarUserMenu";
import ThemeControl from "@/components/layout/ThemeControl";
import {
  Sidebar,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { isStaffRole, type ActorRole } from "@/lib/auth-hierarchy";
import type { ThemeMode } from "@/lib/theme";

type AppSidebarProps = {
  name: string;
  role: ActorRole;
  themeMode: ThemeMode;
};

export default function AppSidebar({ name, role, themeMode }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" aria-label="Main">
      <AssistantTree showUsers={isStaffRole(role)} />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeControl
              appearance="sidebar"
              initialMode={themeMode}
              className="w-full"
            />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarUserMenu name={name} role={role} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

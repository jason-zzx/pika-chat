import AssistantTree from "@/components/assistant/AssistantTree";
import SidebarUserMenu from "@/components/layout/SidebarUserMenu";
import {
  Sidebar,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { ActorRole } from "@/lib/auth-hierarchy";
import type { ThemeMode } from "@/lib/theme";

type AppSidebarProps = {
  name: string;
  role: ActorRole;
  themeMode: ThemeMode;
};

export default function AppSidebar({ name, role, themeMode }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" aria-label="Main">
      <AssistantTree />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarUserMenu name={name} role={role} themeMode={themeMode} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

import { useTranslations } from "next-intl";

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
import type { ThemePreference } from "@/lib/theme";

type AppSidebarProps = {
  name: string;
  role: ActorRole;
  themePreference: ThemePreference;
};

export default function AppSidebar({
  name,
  role,
  themePreference,
}: AppSidebarProps) {
  const t = useTranslations("Layout");

  return (
    <Sidebar collapsible="icon" aria-label={t("sidebar.main")}>
      <AssistantTree showUsers={isStaffRole(role)} />
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeControl
              appearance="sidebar"
              initialPreference={themePreference}
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

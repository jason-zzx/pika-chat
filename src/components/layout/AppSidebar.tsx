import { PlusIcon } from "lucide-react";

import EmptyState from "@/components/common/EmptyState";
import CloseOnNavigateLink from "@/components/layout/CloseOnNavigateLink";
import SidebarNavLink from "@/components/layout/SidebarNavLink";
import SidebarUserMenu from "@/components/layout/SidebarUserMenu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
      <SidebarHeader>
        <div className="flex h-8 items-center px-2">
          <CloseOnNavigateLink href="/">pika-chat</CloseOnNavigateLink>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarNavLink href="/" tooltip="New chat">
              <PlusIcon />
              <span>New chat</span>
            </SidebarNavLink>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Topics</SidebarGroupLabel>
          <SidebarGroupContent>
            <EmptyState
              title="No topics yet"
              description="Conversations will show up here after a provider is configured."
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
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

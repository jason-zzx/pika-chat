"use client";

import { usePathname } from "next/navigation";

import SidebarNavLink from "@/components/layout/SidebarNavLink";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type SettingsTab = {
  href: string;
  label: string;
  staffOnly?: boolean;
};

const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/providers", label: "Providers" },
  { href: "/settings/users", label: "Users", staffOnly: true },
];

type SettingsNavProps = {
  showUsers: boolean;
};

export default function SettingsNav({ showUsers }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label="Settings">
          <SidebarMenu>
            {SETTINGS_TABS.filter((tab) => !tab.staffOnly || showUsers).map(
              (tab) => (
                <SidebarMenuItem key={tab.href}>
                  <SidebarNavLink
                    href={tab.href}
                    tooltip={tab.label}
                    isActive={pathname === tab.href}
                  >
                    <span>{tab.label}</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
              ),
            )}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

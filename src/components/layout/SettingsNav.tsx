"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import SidebarNavLink from "@/components/layout/SidebarNavLink";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type SettingsTabLabelKey = `settingsNav.${"general" | "account" | "providers" | "search" | "users"}`;

type SettingsTab = {
  href: string;
  labelKey: SettingsTabLabelKey;
  staffOnly?: boolean;
};

const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/general", labelKey: "settingsNav.general" },
  { href: "/settings/account", labelKey: "settingsNav.account" },
  { href: "/settings/providers", labelKey: "settingsNav.providers" },
  { href: "/settings/search", labelKey: "settingsNav.search" },
  { href: "/settings/users", labelKey: "settingsNav.users", staffOnly: true },
];

type SettingsNavProps = {
  showUsers: boolean;
};

export default function SettingsNav({ showUsers }: SettingsNavProps) {
  const pathname = usePathname();
  const t = useTranslations("Layout");

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label={t("settingsNav.label")}>
          <SidebarMenu>
            {SETTINGS_TABS.filter((tab) => !tab.staffOnly || showUsers).map(
              (tab) => (
                <SidebarMenuItem key={tab.href}>
                  <SidebarNavLink
                    href={tab.href}
                    tooltip={t(tab.labelKey)}
                    isActive={pathname === tab.href}
                  >
                    <span>{t(tab.labelKey)}</span>
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

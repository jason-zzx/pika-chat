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
import { useIsGuest } from "@/hooks/use-is-guest";

type SettingsTabLabelKey = `settingsNav.${"general" | "models" | "account" | "files" | "providers" | "search" | "users"}`;

type SettingsTab = {
  href: string;
  labelKey: SettingsTabLabelKey;
  staffOnly?: boolean;
  memberOnly?: boolean;
};

const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/general", labelKey: "settingsNav.general" },
  { href: "/settings/models", labelKey: "settingsNav.models" },
  { href: "/settings/account", labelKey: "settingsNav.account", memberOnly: true },
  { href: "/settings/files", labelKey: "settingsNav.files" },
  { href: "/settings/providers", labelKey: "settingsNav.providers", memberOnly: true },
  { href: "/settings/search", labelKey: "settingsNav.search", memberOnly: true },
  { href: "/settings/users", labelKey: "settingsNav.users", staffOnly: true },
];

type SettingsNavProps = {
  showUsers: boolean;
};

export default function SettingsNav({ showUsers }: SettingsNavProps) {
  const pathname = usePathname();
  const isGuest = useIsGuest();
  const t = useTranslations("Layout");

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label={t("settingsNav.label")}>
          <SidebarMenu>
            {SETTINGS_TABS.filter(
              (tab) =>
                (!tab.staffOnly || showUsers) && (!tab.memberOnly || !isGuest),
            ).map((tab) => (
              <SidebarMenuItem key={tab.href}>
                <SidebarNavLink
                  href={tab.href}
                  tooltip={t(tab.labelKey)}
                  isActive={pathname === tab.href}
                >
                  <span>{t(tab.labelKey)}</span>
                </SidebarNavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

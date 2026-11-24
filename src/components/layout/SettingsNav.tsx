"use client";

import {
  BlocksIcon,
  FolderOpenIcon,
  GlobeIcon,
  InfoIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
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

type SettingsTabLabelKey = `settingsNav.${"general" | "models" | "account" | "files" | "providers" | "search" | "users" | "about"}`;

type SettingsTab = {
  href: string;
  labelKey: SettingsTabLabelKey;
  icon: LucideIcon;
  staffOnly?: boolean;
  memberOnly?: boolean;
  remoteOnly?: boolean;
};

const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/general", labelKey: "settingsNav.general", icon: SettingsIcon },
  { href: "/settings/models", labelKey: "settingsNav.models", icon: SparklesIcon },
  { href: "/settings/account", labelKey: "settingsNav.account", icon: ShieldCheckIcon, memberOnly: true, remoteOnly: true },
  { href: "/settings/files", labelKey: "settingsNav.files", icon: FolderOpenIcon },
  { href: "/settings/providers", labelKey: "settingsNav.providers", icon: BlocksIcon, memberOnly: true },
  { href: "/settings/search", labelKey: "settingsNav.search", icon: GlobeIcon, memberOnly: true },
  { href: "/settings/users", labelKey: "settingsNav.users", icon: UsersIcon, staffOnly: true },
  { href: "/settings/about", labelKey: "settingsNav.about", icon: InfoIcon },
];

type SettingsNavProps = {
  showUsers: boolean;
  local?: boolean;
};

export default function SettingsNav({ showUsers, local = false }: SettingsNavProps) {
  const pathname = usePathname();
  const isGuest = useIsGuest();
  const t = useTranslations("Layout");

  return (
    <SidebarGroup className="thin-scrollbar min-h-0 flex-1 overflow-x-clip overflow-y-auto">
      <SidebarGroupContent>
        <nav aria-label={t("settingsNav.label")}>
          <SidebarMenu>
            {SETTINGS_TABS.filter(
              (tab) =>
                (!tab.staffOnly || showUsers) &&
                (!tab.memberOnly || !isGuest) &&
                (!tab.remoteOnly || !local),
            ).map((tab) => (
              <SidebarMenuItem key={tab.href}>
                <SidebarNavLink
                  href={tab.href}
                  tooltip={t(tab.labelKey)}
                  isActive={pathname === tab.href}
                  replace
                >
                  <tab.icon aria-hidden="true" />
                  <span className="truncate group-data-[collapsible=icon]:hidden">
                    {t(tab.labelKey)}
                  </span>
                </SidebarNavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

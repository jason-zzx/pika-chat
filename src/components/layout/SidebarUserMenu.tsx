"use client";

import { CircleUserRoundIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { useIsGuest } from "@/hooks/use-is-guest";
import { usePikaNative } from "@/hooks/use-pika-native";
import type { ActorRole } from "@/lib/auth-hierarchy";
import { signOutAndReset } from "@/lib/sign-out";

type SidebarUserMenuProps = {
  name: string;
  role: ActorRole;
  local?: boolean;
};

export default function SidebarUserMenu({
  name,
  role,
  local = false,
}: SidebarUserMenuProps) {
  const { setOpenMobile } = useSidebar();
  const isGuest = useIsGuest();
  const native = usePikaNative();
  const t = useTranslations("Layout");
  const tAuth = useTranslations("Auth");
  const tServer = useTranslations("Layout.desktopServer");

  async function onSignOut() {
    setOpenMobile(false);
    // Last action of this document: the old account's query cache, chat pool
    // and in-flight subscriptions are discarded by the full page load. A
    // failed sign-out leaves the document (and the session) intact and says so.
    try {
      await signOutAndReset();
    } catch {
      toast.add({ type: "error", title: tAuth("signOutFailed") });
    }
  }

  function onSwitchServer() {
    native?.openServers("list");
  }
  // navigator is only read once the bridge exists, i.e. on the client.
  // The shell hotkey only exists on desktop; the Android shell has no keyboard shortcut.
  const switchShortcut = !native || navigator.userAgent.includes("Android")
    ? null
    : navigator.userAgent.includes("Mac")
      ? "⌘⇧L"
      : "Ctrl+Shift+L";

  return (
    <div className="flex w-full min-w-0 items-center gap-1 group-data-[collapsible=icon]:flex-col">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton className="flex-1" tooltip={name} />
          }
          aria-label={t("userMenu.accountMenu", { name })}
        >
          <CircleUserRoundIcon aria-hidden="true" />
          <span className="truncate">{name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {isGuest
                ? `${name} · ${t("userMenu.guestBadge")}`
                : `${name} · ${role === "super_admin" ? t("userMenu.superAdmin") : role}`}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {native ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate font-normal">
                  {local || native.serverName === window.location.host
                    ? native.serverName
                    : `${native.serverName} · ${window.location.host}`}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={onSwitchServer}>
                  {tServer("switchItem")}
                  {switchShortcut ? (
                    <DropdownMenuShortcut>{switchShortcut}</DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
          {!isGuest && !local ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void onSignOut()}>
                {t("userMenu.signOut")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarMenuButton
        render={<Link href="/settings" />}
        tooltip={t("userMenu.settings")}
        aria-label={t("userMenu.settings")}
        className="size-8 shrink-0"
        onClick={() => setOpenMobile(false)}
      >
        <SettingsIcon aria-hidden="true" />
        <span className="sr-only">{t("userMenu.settings")}</span>
      </SidebarMenuButton>
    </div>
  );
}

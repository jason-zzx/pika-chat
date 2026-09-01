import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppShell from "@/components/layout/AppShell";
import { parseThemeCookie, THEME_COOKIE_NAME } from "@/lib/theme";
import { resolveActor } from "@/server/auth/actor";

const SIDEBAR_STATE_COOKIE = "sidebar_state";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const defaultSidebarOpen =
    cookieStore.get(SIDEBAR_STATE_COOKIE)?.value !== "false";
  const theme = parseThemeCookie(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <AppShell
      defaultSidebarOpen={defaultSidebarOpen}
      user={{ name: actor.name, role: actor.role }}
      themeMode={theme.mode}
    >
      {children}
    </AppShell>
  );
}

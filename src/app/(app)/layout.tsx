import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppShell from "@/components/layout/AppShell";
import { resolveActor } from "@/server/auth/actor";
import { getUserThemePreference } from "@/server/services/user-preferences.service";

const SIDEBAR_STATE_COOKIE = "sidebar_state";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const defaultSidebarOpen =
    cookieStore.get(SIDEBAR_STATE_COOKIE)?.value !== "false";
  // Signed-in users: the DB is the theme source of truth (the cookie only
  // serves anonymous pages and the system-mode resolved hint).
  const themePreference = await getUserThemePreference(actor.userId);

  return (
    <AppShell
      defaultSidebarOpen={defaultSidebarOpen}
      user={{ name: actor.name, role: actor.role }}
      themePreference={themePreference}
    >
      {children}
    </AppShell>
  );
}

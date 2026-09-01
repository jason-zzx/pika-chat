import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export default async function SettingsUsersLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  if (!isStaffRole(actor.role)) {
    redirect("/settings/general");
  }
  return children;
}

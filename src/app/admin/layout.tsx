import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  if (!isStaffRole(actor.role)) {
    redirect("/");
  }
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}

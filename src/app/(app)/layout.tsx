import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { resolveActor } from "@/server/auth/actor";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}

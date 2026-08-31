import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { resolveActor } from "@/server/auth/actor";

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await resolveActor(await headers());
  if (actor) {
    redirect("/");
  }
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      {children}
    </div>
  );
}

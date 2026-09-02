import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import PikaMark from "@/components/common/PikaMark";
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
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <PikaMark className="size-9" />
          <p className="font-semibold tracking-tight">Pika chat</p>
        </div>
        {children}
      </div>
    </div>
  );
}

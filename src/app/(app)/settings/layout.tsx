import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import PageContainer from "@/components/layout/PageContainer";
import SettingsNav from "@/components/layout/SettingsNav";
import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }

  return (
    <PageContainer>
      <SettingsNav showUsers={isStaffRole(actor.role)} />
      {children}
    </PageContainer>
  );
}

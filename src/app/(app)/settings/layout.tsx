import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import InsetHeader from "@/components/layout/InsetHeader";
import PageContainer from "@/components/layout/PageContainer";
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
    <>
      <InsetHeader />
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        <PageContainer>{children}</PageContainer>
      </div>
    </>
  );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import InsetHeader from "@/components/layout/InsetHeader";
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

  const t = await getTranslations("Layout");

  return (
    <>
      <InsetHeader title={t("settingsNav.label")} className="md:hidden" />
      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </>
  );
}

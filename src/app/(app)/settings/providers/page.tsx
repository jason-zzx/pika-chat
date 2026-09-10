import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import PageHeader from "@/components/layout/PageHeader";
import ProviderConfigsScreen from "@/components/provider/ProviderConfigsScreen";
import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export default async function SettingsProvidersPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Settings.Providers");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ProviderConfigsScreen canShare={isStaffRole(actor.role)} />
    </>
  );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import ProviderConfigsScreen from "@/components/provider/ProviderConfigsScreen";
import { isStaffRole } from "@/lib/auth-hierarchy";
import { resolveActor } from "@/server/auth/actor";

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.Providers"))("title"),
});

export default async function SettingsProvidersPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Settings.Providers");

  return (
    <PageContainer className="max-w-none md:min-h-0">
      <PageHeader title={t("title")} description={t("description")} />
      <ProviderConfigsScreen canShare={isStaffRole(actor.role)} />
    </PageContainer>
  );
}

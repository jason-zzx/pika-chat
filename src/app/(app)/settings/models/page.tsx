import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import ModelPreferencesScreen from "@/components/settings/models/ModelPreferencesScreen";
import { resolveActor } from "@/server/auth/actor";

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.Models"))("title"),
});

export default async function SettingsModelsPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  const t = await getTranslations("Settings.Models");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <ModelPreferencesScreen />
    </PageContainer>
  );
}

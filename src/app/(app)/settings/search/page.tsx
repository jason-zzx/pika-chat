import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import SearchProvidersScreen from "@/components/search/SearchProvidersScreen";
import { resolveActor } from "@/server/auth/actor";

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.Search"))("title"),
});

export default async function SettingsSearchPage() {
  const actor = await resolveActor(await headers());
  if (!actor) {
    redirect("/sign-in");
  }
  if (actor.isGuest) {
    redirect("/settings/general");
  }
  const t = await getTranslations("Settings.Search");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SearchProvidersScreen />
    </PageContainer>
  );
}

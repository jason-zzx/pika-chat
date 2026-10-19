import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import SearchProvidersScreen from "@/components/search/SearchProvidersScreen";

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.Search"))("title"),
});

export default function SettingsSearchPage() {
  const t = useTranslations("Settings.Search");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SearchProvidersScreen />
    </PageContainer>
  );
}

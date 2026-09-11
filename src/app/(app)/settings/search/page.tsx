import { useTranslations } from "next-intl";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import SearchProvidersScreen from "@/components/search/SearchProvidersScreen";

export default function SettingsSearchPage() {
  const t = useTranslations("Settings.Search");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <SearchProvidersScreen />
    </PageContainer>
  );
}

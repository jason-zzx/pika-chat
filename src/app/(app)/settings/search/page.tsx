import { useTranslations } from "next-intl";

import PageHeader from "@/components/layout/PageHeader";
import SearchProvidersScreen from "@/components/search/SearchProvidersScreen";

export default function SettingsSearchPage() {
  const t = useTranslations("Settings.Search");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SearchProvidersScreen />
    </>
  );
}

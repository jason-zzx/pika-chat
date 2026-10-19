import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import FilesScreen from "@/components/settings/files/FilesScreen";

export const generateMetadata = async () => ({
  title: (await getTranslations("Settings.Files"))("title"),
});

export default function SettingsFilesPage() {
  const t = useTranslations("Settings.Files");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <FilesScreen />
    </PageContainer>
  );
}

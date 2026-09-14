import { useTranslations } from "next-intl";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import FilesScreen from "@/components/settings/files/FilesScreen";

export default function SettingsFilesPage() {
  const t = useTranslations("Settings.Files");

  return (
    <PageContainer>
      <PageHeader title={t("title")} description={t("description")} />
      <FilesScreen />
    </PageContainer>
  );
}
